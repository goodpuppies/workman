//! WON reader, canonical writer, and serde format (experiment).
//! The serde mapping follows markdown/won-mapping.md; edges are recorded in
//! markdown/won-ipc.md.

mod de;
mod ser;

pub use de::from_value;
pub use ser::to_value;

use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Boolean(bool),
    /// The exact token spelling.
    Number(String),
    Text(String),
    Blob(Vec<u8>),
    List(Vec<Value>),
    /// Field order is preserved; keys are unique.
    Record(Vec<(String, Value)>),
    Tag { name: String, attributes: Vec<(String, Value)>, payload: Box<Value> },
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Record(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    Syntax { offset: usize, message: &'static str },
    /// A programmatic value breaks a format invariant.
    InvalidValue(String),
    /// A typed conversion failed.
    Message(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Syntax { offset, message } => write!(f, "byte {offset}: {message}"),
            Error::InvalidValue(m) | Error::Message(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// Parse a document straight into `T`.
pub fn from_str<T: serde::de::DeserializeOwned>(source: &str) -> Result<T> {
    from_value(parse(source.as_bytes())?)
}

/// Render `value` as one line of canonical WON.
pub fn to_string<T: serde::Serialize + ?Sized>(value: &T) -> Result<String> {
    write(&to_value(value)?)
}

pub const MAX_DEPTH: usize = 128;

pub fn parse(source: &[u8]) -> Result<Value> {
    let mut p = Parser { src: source, pos: 0 };
    let value = p.value(0)?;
    p.skip()?;
    if p.pos != p.src.len() {
        return Err(p.fail(p.pos, "unexpected trailing input"));
    }
    Ok(value)
}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn fail(&self, offset: usize, message: &'static str) -> Error {
        Error::Syntax { offset, message }
    }

    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }

    fn starts_with(&self, prefix: &[u8]) -> bool {
        self.src[self.pos..].starts_with(prefix)
    }

    /// Whitespace, commas, `//` comments, and nested `/* */` comments.
    fn skip(&mut self) -> Result<()> {
        while let Some(c) = self.peek() {
            if matches!(c, b' ' | b'\t' | b'\r' | b'\n' | b',') {
                self.pos += 1;
            } else if self.starts_with(b"//") {
                while !matches!(self.peek(), None | Some(b'\n' | b'\r')) {
                    self.pos += 1;
                }
            } else if self.starts_with(b"/*") {
                let start = self.pos;
                let mut depth = 0;
                loop {
                    if self.pos >= self.src.len() {
                        return Err(self.fail(start, "unterminated block comment"));
                    }
                    if self.starts_with(b"/*") {
                        depth += 1;
                        self.pos += 2;
                    } else if self.starts_with(b"*/") {
                        depth -= 1;
                        self.pos += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        self.pos += 1;
                    }
                }
            } else {
                break;
            }
        }
        Ok(())
    }

    fn value(&mut self, depth: usize) -> Result<Value> {
        self.skip()?;
        if depth > MAX_DEPTH {
            return Err(self.fail(self.pos, "maximum nesting depth exceeded"));
        }
        let c = self.peek().ok_or_else(|| self.fail(self.pos, "expected value"))?;
        if c == b'"' {
            return Ok(Value::Text(self.text()?));
        }
        if self.starts_with(b"x\"") {
            return Ok(Value::Blob(self.blob()?));
        }
        match c {
            b'[' => return Ok(Value::List(self.list(depth)?)),
            b'{' => return Ok(Value::Record(self.record(depth)?)),
            b'-' | b'0'..=b'9' => return Ok(Value::Number(self.number()?)),
            _ => {}
        }
        let start = self.pos;
        let word = self.name().ok_or_else(|| self.fail(start, "expected value"))?;
        Ok(match word.as_str() {
            "null" => Value::Null,
            "true" => Value::Boolean(true),
            "false" => Value::Boolean(false),
            _ => self.tag(word, depth)?,
        })
    }

    fn name(&mut self) -> Option<String> {
        let start = self.pos;
        if !self.peek().is_some_and(is_name_start) {
            return None;
        }
        while self.peek().is_some_and(is_name_char) {
            self.pos += 1;
        }
        Some(String::from_utf8(self.src[start..self.pos].to_vec()).unwrap())
    }

    /// Attribute and payload delimiters must touch the name or `>`.
    fn tag(&mut self, name: String, depth: usize) -> Result<Value> {
        let mut attributes = Vec::new();
        if self.peek() == Some(b'<') {
            let at = self.pos;
            self.pos += 1;
            attributes = self.fields(depth, b'>')?;
            if attributes.is_empty() {
                return Err(self.fail(at, "omit empty tag attributes"));
            }
        }
        let payload = match self.peek() {
            Some(b'[') => Value::List(self.list(depth)?),
            Some(b'{') => Value::Record(self.record(depth)?),
            Some(b'(') => {
                let at = self.pos;
                self.pos += 1;
                let inner = self.value(depth + 1)?;
                match inner {
                    Value::Null => return Err(self.fail(at, "omit null tag payload")),
                    Value::List(_) => return Err(self.fail(at, "list tag payload must use []")),
                    Value::Record(_) => return Err(self.fail(at, "record tag payload must use {}")),
                    _ => {}
                }
                self.skip()?;
                if self.peek() != Some(b')') {
                    return Err(self.fail(self.pos, "expected )"));
                }
                self.pos += 1;
                inner
            }
            _ => Value::Null,
        };
        Ok(Value::Tag { name, attributes, payload: Box::new(payload) })
    }

    /// After an entry: the container closes, or at least one separator follows.
    fn separated(&mut self, close: u8) -> Result<()> {
        let end = self.pos;
        self.skip()?;
        if self.peek() != Some(close) && self.pos == end {
            return Err(self.fail(self.pos, "expected whitespace between values or fields"));
        }
        Ok(())
    }

    fn list(&mut self, depth: usize) -> Result<Vec<Value>> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip()?;
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(items);
            }
            items.push(self.value(depth + 1)?);
            self.separated(b']')?;
        }
    }

    fn record(&mut self, depth: usize) -> Result<Vec<(String, Value)>> {
        self.pos += 1;
        self.fields(depth, b'}')
    }

    fn fields(&mut self, depth: usize, close: u8) -> Result<Vec<(String, Value)>> {
        let mut items: Vec<(String, Value)> = Vec::new();
        loop {
            self.skip()?;
            if self.peek() == Some(close) {
                self.pos += 1;
                return Ok(items);
            }
            let at = self.pos;
            let key = self.key()?;
            if items.iter().any(|(k, _)| *k == key) {
                return Err(self.fail(at, "duplicate field"));
            }
            self.skip()?;
            if self.peek() != Some(b'=') {
                return Err(self.fail(self.pos, "expected ="));
            }
            self.pos += 1;
            let value = self.value(depth + 1)?;
            items.push((key, value));
            self.separated(close)?;
        }
    }

    fn key(&mut self) -> Result<String> {
        let at = self.pos;
        if self.peek() == Some(b'"') {
            let quoted = self.text()?;
            if is_identifier(&quoted) {
                return Err(self.fail(at, "identifier keys must be bare"));
            }
            return Ok(quoted);
        }
        self.name().ok_or_else(|| self.fail(at, "expected name"))
    }

    fn number(&mut self) -> Result<String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        let whole = self.digits();
        if whole == 0 || (whole > 1 && self.src[self.pos - whole] == b'0') {
            return Err(self.fail(start, "invalid number"));
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if self.digits() == 0 {
                return Err(self.fail(self.pos, "expected digit"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if self.digits() == 0 {
                return Err(self.fail(self.pos, "expected digit"));
            }
        }
        Ok(String::from_utf8(self.src[start..self.pos].to_vec()).unwrap())
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.pos += 1;
        }
        self.pos - start
    }

    fn text(&mut self) -> Result<String> {
        let start = self.pos;
        self.pos += 1;
        let mut out = Vec::new();
        loop {
            let c = self.peek().ok_or_else(|| self.fail(start, "unterminated quoted value"))?;
            match c {
                b'"' => break,
                b'\\' => {
                    let decoded = match self.src.get(self.pos + 1) {
                        Some(b'n') => b'\n',
                        Some(b'r') => b'\r',
                        Some(b't') => b'\t',
                        Some(b'"') => b'"',
                        Some(b'\\') => b'\\',
                        Some(b'x') => {
                            let byte = hex_pair(&self.src[(self.pos + 2).min(self.src.len())..])
                                .ok_or_else(|| self.fail(self.pos, "expected two hex digits after \\x"))?;
                            if !is_control(byte) || matches!(byte, b'\n' | b'\r' | b'\t') {
                                return Err(self.fail(self.pos, "use literal UTF-8 or the named text escape"));
                            }
                            self.pos += 2;
                            byte
                        }
                        _ => return Err(self.fail(self.pos, "unknown escape")),
                    };
                    self.pos += 2;
                    out.push(decoded);
                }
                _ if is_control(c) => return Err(self.fail(self.pos, "control byte must be escaped")),
                _ => {
                    out.push(c);
                    self.pos += 1;
                }
            }
        }
        self.pos += 1;
        String::from_utf8(out).map_err(|_| self.fail(start, "text is not valid UTF-8"))
    }

    fn blob(&mut self) -> Result<Vec<u8>> {
        self.pos += 2;
        let mut out = Vec::new();
        while self.peek() != Some(b'"') {
            if self.pos + 1 >= self.src.len() {
                return Err(self.fail(self.pos, "unterminated hex blob"));
            }
            out.push(hex_pair(&self.src[self.pos..])
                .ok_or_else(|| self.fail(self.pos, "hex blob requires pairs of hex digits"))?);
            self.pos += 2;
        }
        self.pos += 1;
        Ok(out)
    }
}

fn is_name_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}

fn is_name_char(c: u8) -> bool {
    is_name_start(c) || c.is_ascii_digit()
}

pub fn is_identifier(s: &str) -> bool {
    let mut bytes = s.bytes();
    bytes.next().is_some_and(is_name_start) && bytes.all(is_name_char)
}

fn is_control(c: u8) -> bool {
    c < 0x20 || c == 0x7f
}

fn hex_digit(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    }
}

fn hex_pair(s: &[u8]) -> Option<u8> {
    Some(hex_digit(*s.first()?)? * 16 + hex_digit(*s.get(1)?)?)
}

/// True when `s` is a complete token under the number grammar.
pub fn is_number(s: &str) -> bool {
    let mut p = Parser { src: s.as_bytes(), pos: 0 };
    p.number().is_ok() && p.pos == s.len()
}

/// Canonical output after checking the format's invariants.
pub fn write(value: &Value) -> Result<String> {
    validate(value, 0)?;
    let mut out = String::new();
    render(&mut out, value);
    Ok(out)
}

fn validate(value: &Value, depth: usize) -> Result<()> {
    let invalid = |m: &str| Err(Error::InvalidValue(m.into()));
    if depth > MAX_DEPTH {
        return invalid("maximum nesting depth exceeded");
    }
    match value {
        Value::Number(s) if !is_number(s) => invalid("invalid number spelling"),
        Value::List(items) => items.iter().try_for_each(|v| validate(v, depth + 1)),
        Value::Record(fields) => validate_fields(fields, depth),
        Value::Tag { name, attributes, payload } => {
            if !is_identifier(name) || matches!(name.as_str(), "null" | "true" | "false") {
                return invalid("invalid tag name");
            }
            validate_fields(attributes, depth)?;
            validate(payload, depth + 1)
        }
        _ => Ok(()),
    }
}

fn validate_fields(fields: &[(String, Value)], depth: usize) -> Result<()> {
    for (i, (key, value)) in fields.iter().enumerate() {
        if fields[..i].iter().any(|(k, _)| k == key) {
            return Err(Error::InvalidValue(format!("duplicate field {key}")));
        }
        validate(value, depth + 1)?;
    }
    Ok(())
}

fn render(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(s) => out.push_str(s),
        Value::Text(s) => quote(out, s),
        Value::Blob(bytes) => {
            out.push_str("x\"");
            for b in bytes {
                out.push_str(&format!("{b:02x}"));
            }
            out.push('"');
        }
        Value::List(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                render(out, item);
            }
            out.push(']');
        }
        Value::Record(fields) => {
            out.push('{');
            render_fields(out, fields);
            out.push('}');
        }
        Value::Tag { name, attributes, payload } => {
            out.push_str(name);
            if !attributes.is_empty() {
                out.push('<');
                render_fields(out, attributes);
                out.push('>');
            }
            match **payload {
                Value::Null => {}
                Value::List(_) | Value::Record(_) => render(out, payload),
                _ => {
                    out.push('(');
                    render(out, payload);
                    out.push(')');
                }
            }
        }
    }
}

fn render_fields(out: &mut String, fields: &[(String, Value)]) {
    for (i, (key, value)) in fields.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        if is_identifier(key) {
            out.push_str(key);
        } else {
            quote(out, key);
        }
        out.push_str(" = ");
        render(out, value);
    }
}

fn quote(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

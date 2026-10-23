//! serde Deserializer over an owned `Value`, following markdown/won-mapping.md.
use crate::ser::RAW_TOKEN;
use crate::{Error, Result, Value};
use serde::de::{self, DeserializeSeed, IntoDeserializer, Visitor};

pub fn from_value<T: de::DeserializeOwned>(value: Value) -> Result<T> {
    T::deserialize(value)
}

impl de::Error for Error {
    fn custom<T: std::fmt::Display>(msg: T) -> Self {
        Error::Message(msg.to_string())
    }
}

impl<'de> de::Deserialize<'de> for Value {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_newtype_struct(RAW_TOKEN, Raw)
    }
}

/// From this crate's deserializer, a `Value` arrives intact as WON text.
struct Raw;

impl<'de> Visitor<'de> for Raw {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a WON value")
    }
    fn visit_str<E: de::Error>(self, text: &str) -> std::result::Result<Value, E> {
        crate::parse(text.as_bytes()).map_err(E::custom)
    }
    /// Through serde's buffering (`flatten`, `untagged`) the escape hatch is
    /// lost; rebuild from serde's data model, which is JSON-shaped.
    fn visit_newtype_struct<D: de::Deserializer<'de>>(self, d: D) -> std::result::Result<Value, D::Error> {
        d.deserialize_any(Generic)
    }
}

/// Lossy: numbers lose their spelling, and a tag, presented as `{Name: payload}`,
/// comes back as a one-entry record.
struct Generic;

impl<'de> Visitor<'de> for Generic {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("any value")
    }
    fn visit_unit<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_bool<E>(self, b: bool) -> std::result::Result<Value, E> {
        Ok(Value::Boolean(b))
    }
    fn visit_i64<E>(self, n: i64) -> std::result::Result<Value, E> {
        Ok(Value::Number(n.to_string()))
    }
    fn visit_u64<E>(self, n: u64) -> std::result::Result<Value, E> {
        Ok(Value::Number(n.to_string()))
    }
    fn visit_f64<E: de::Error>(self, f: f64) -> std::result::Result<Value, E> {
        crate::to_value(&f).map_err(E::custom)
    }
    fn visit_str<E>(self, s: &str) -> std::result::Result<Value, E> {
        Ok(Value::Text(s.into()))
    }
    fn visit_bytes<E>(self, b: &[u8]) -> std::result::Result<Value, E> {
        Ok(Value::Blob(b.into()))
    }
    fn visit_none<E>(self) -> std::result::Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_some<D: de::Deserializer<'de>>(self, d: D) -> std::result::Result<Value, D::Error> {
        d.deserialize_any(self)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element_seed(GenericSeed)? {
            items.push(item);
        }
        Ok(Value::List(items))
    }
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> std::result::Result<Value, A::Error> {
        let mut fields = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            fields.push((key, map.next_value_seed(GenericSeed)?));
        }
        Ok(Value::Record(fields))
    }
}

struct GenericSeed;

impl<'de> DeserializeSeed<'de> for GenericSeed {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> std::result::Result<Value, D::Error> {
        d.deserialize_any(Generic)
    }
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Boolean(_) => "boolean",
        Value::Number(_) => "number",
        Value::Text(_) => "text",
        Value::Blob(_) => "blob",
        Value::List(_) => "list",
        Value::Record(_) => "record",
        Value::Tag { .. } => "tag",
    }
}

fn expected<T>(what: &str, got: &Value) -> Result<T> {
    Err(Error::Message(format!("expected {what}, found {}", kind(got))))
}

/// Integers accept integer spellings only, so `1e3` and `1.0` are errors.
macro_rules! integer {
    ($method:ident, $visit:ident, $t:ty) => {
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
            match &self {
                Value::Number(s) => match s.parse::<$t>() {
                    Ok(n) => visitor.$visit(n),
                    Err(_) => Err(Error::Message(format!("{s} is not a valid {}", stringify!($t)))),
                },
                other => expected("number", other),
            }
        }
    };
}

macro_rules! float {
    ($method:ident, $visit:ident, $t:ty) => {
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
            match &self {
                Value::Number(s) => match s.parse::<$t>() {
                    Ok(f) if f.is_finite() => visitor.$visit(f),
                    _ => Err(Error::Message(format!("{s} is not a finite {}", stringify!($t)))),
                },
                other => expected("number", other),
            }
        }
    };
}

impl<'de> de::Deserializer<'de> for Value {
    type Error = Error;

    /// Self-describing input, used by `#[serde(untagged)]`, `flatten`, and
    /// internally tagged enums. serde buffers it in a `Content` that cannot
    /// hold enum input, so a tag is presented as a one-entry map
    /// `{Name: payload}`, the shape serde_json gives externally tagged enums.
    /// Numbers become the narrowest host number that holds them exactly.
    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Null => visitor.visit_unit(),
            Value::Boolean(b) => visitor.visit_bool(b),
            Value::Number(s) => {
                if let Ok(n) = s.parse::<u64>() {
                    visitor.visit_u64(n)
                } else if let Ok(n) = s.parse::<i64>() {
                    visitor.visit_i64(n)
                } else if let Ok(n) = s.parse::<u128>() {
                    visitor.visit_u128(n)
                } else if let Ok(n) = s.parse::<i128>() {
                    visitor.visit_i128(n)
                } else {
                    match s.parse::<f64>() {
                        Ok(f) if f.is_finite() => visitor.visit_f64(f),
                        _ => Err(Error::Message(format!("{s} does not fit a host number"))),
                    }
                }
            }
            Value::Text(s) => visitor.visit_string(s),
            Value::Blob(b) => visitor.visit_byte_buf(b),
            Value::List(items) => visit_list(items, visitor),
            Value::Record(fields) => visitor.visit_map(Fields::new(fields)),
            Value::Tag { name, attributes, payload } => {
                if !attributes.is_empty() {
                    return Err(Error::Message(format!("{name}: tag attributes have no typed counterpart")));
                }
                visitor.visit_map(Fields::new(vec![(name, *payload)]))
            }
        }
    }

    fn deserialize_bool<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Boolean(b) => visitor.visit_bool(b),
            other => expected("boolean", &other),
        }
    }

    integer!(deserialize_i8, visit_i8, i8);
    integer!(deserialize_i16, visit_i16, i16);
    integer!(deserialize_i32, visit_i32, i32);
    integer!(deserialize_i64, visit_i64, i64);
    integer!(deserialize_i128, visit_i128, i128);
    integer!(deserialize_u8, visit_u8, u8);
    integer!(deserialize_u16, visit_u16, u16);
    integer!(deserialize_u32, visit_u32, u32);
    integer!(deserialize_u64, visit_u64, u64);
    integer!(deserialize_u128, visit_u128, u128);
    float!(deserialize_f32, visit_f32, f32);
    float!(deserialize_f64, visit_f64, f64);

    fn deserialize_char<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match &self {
            Value::Text(s) if s.chars().count() == 1 => visitor.visit_char(s.chars().next().unwrap()),
            other => expected("text of one character", other),
        }
    }

    fn deserialize_str<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        self.deserialize_string(visitor)
    }

    fn deserialize_string<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Text(s) => visitor.visit_string(s),
            other => expected("text", &other),
        }
    }

    fn deserialize_bytes<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        self.deserialize_byte_buf(visitor)
    }

    fn deserialize_byte_buf<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Blob(b) => visitor.visit_byte_buf(b),
            other => expected("blob", &other),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Null => visitor.visit_none(),
            other => visitor.visit_some(other),
        }
    }

    fn deserialize_unit<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Null => visitor.visit_unit(),
            other => expected("null", &other),
        }
    }

    fn deserialize_unit_struct<V: Visitor<'de>>(self, _name: &'static str, visitor: V) -> Result<V::Value> {
        self.deserialize_unit(visitor)
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(self, name: &'static str, visitor: V) -> Result<V::Value> {
        if name == RAW_TOKEN {
            return visitor.visit_string(crate::write(&self)?);
        }
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_seq<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::List(items) => visit_list(items, visitor),
            other => expected("list", &other),
        }
    }

    fn deserialize_tuple<V: Visitor<'de>>(self, len: usize, visitor: V) -> Result<V::Value> {
        match self {
            Value::List(items) if items.len() == len => visit_list(items, visitor),
            Value::List(items) => Err(Error::Message(format!("expected a list of {len}, found {}", items.len()))),
            other => expected("list", &other),
        }
    }

    fn deserialize_tuple_struct<V: Visitor<'de>>(self, _name: &'static str, len: usize, visitor: V) -> Result<V::Value> {
        self.deserialize_tuple(len, visitor)
    }

    fn deserialize_map<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        match self {
            Value::Record(fields) => visitor.visit_map(Fields::new(fields)),
            other => expected("record", &other),
        }
    }

    /// A struct may arrive wrapped in a tag naming its type: `AppConfig{…}`.
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value> {
        match self {
            Value::Record(fields) => visitor.visit_map(Fields::new(fields)),
            Value::Tag { name: tag, attributes, payload } if tag == name && attributes.is_empty() => match *payload {
                Value::Record(fields) => visitor.visit_map(Fields::new(fields)),
                other => expected("record payload", &other),
            },
            other => expected("record", &other),
        }
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value> {
        match self {
            Value::Tag { name, attributes, payload } => {
                if !attributes.is_empty() {
                    return Err(Error::Message(format!("{name}: tag attributes have no typed counterpart")));
                }
                visitor.visit_enum(Variant { name, payload: *payload })
            }
            other => expected("tag", &other),
        }
    }

    fn deserialize_identifier<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        self.deserialize_string(visitor)
    }

    fn deserialize_ignored_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value> {
        visitor.visit_unit()
    }
}

fn visit_list<'de, V: Visitor<'de>>(items: Vec<Value>, visitor: V) -> Result<V::Value> {
    let mut seq = Items(items.into_iter());
    let result = visitor.visit_seq(&mut seq)?;
    match seq.0.len() {
        0 => Ok(result),
        extra => Err(Error::Message(format!("{extra} more list items than expected"))),
    }
}

struct Items(std::vec::IntoIter<Value>);

impl<'de> de::SeqAccess<'de> for Items {
    type Error = Error;
    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>> {
        self.0.next().map(|v| seed.deserialize(v)).transpose()
    }
    fn size_hint(&self) -> Option<usize> {
        Some(self.0.len())
    }
}

struct Fields {
    entries: std::vec::IntoIter<(String, Value)>,
    pending: Option<Value>,
}

impl Fields {
    fn new(fields: Vec<(String, Value)>) -> Self {
        Fields { entries: fields.into_iter(), pending: None }
    }
}

impl<'de> de::MapAccess<'de> for Fields {
    type Error = Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, seed: K) -> Result<Option<K::Value>> {
        match self.entries.next() {
            Some((key, value)) => {
                self.pending = Some(value);
                seed.deserialize(Value::Text(key)).map(Some)
            }
            None => Ok(None),
        }
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value> {
        seed.deserialize(self.pending.take().expect("next_key_seed before next_value_seed"))
    }
}

struct Variant {
    name: String,
    payload: Value,
}

impl<'de> de::EnumAccess<'de> for Variant {
    type Error = Error;
    type Variant = Value;
    fn variant_seed<V: DeserializeSeed<'de>>(self, seed: V) -> Result<(V::Value, Value)> {
        let name: de::value::StringDeserializer<Error> = self.name.into_deserializer();
        Ok((seed.deserialize(name)?, self.payload))
    }
}

impl<'de> de::VariantAccess<'de> for Value {
    type Error = Error;
    fn unit_variant(self) -> Result<()> {
        match self {
            Value::Null => Ok(()),
            other => expected("a bare tag", &other),
        }
    }
    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value> {
        seed.deserialize(self)
    }
    fn tuple_variant<V: Visitor<'de>>(self, len: usize, visitor: V) -> Result<V::Value> {
        de::Deserializer::deserialize_tuple(self, len, visitor)
    }
    fn struct_variant<V: Visitor<'de>>(self, _fields: &'static [&'static str], visitor: V) -> Result<V::Value> {
        de::Deserializer::deserialize_map(self, visitor)
    }
}

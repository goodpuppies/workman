//! serde Serializer producing a `Value`.
//!
//! `Ok` is `Option<Value>`: `serialize_none` yields `None` (absent), which a
//! struct omits and every other position writes as `null`. That is the only
//! way to tell an `Option` field from an explicit `null`: serde gives a struct
//! serializer the field's value, not its type.
use crate::{Error, Result, Value};
use serde::ser::{self, Serialize};

/// Newtype name that carries an untyped `Value` through serde as WON text,
/// the same escape hatch serde_json uses for `RawValue`.
pub(crate) const RAW_TOKEN: &str = "$won::Value";

pub fn to_value<T: Serialize + ?Sized>(value: &T) -> Result<Value> {
    Ok(value.serialize(Serializer)?.unwrap_or(Value::Null))
}

impl ser::Error for Error {
    fn custom<T: std::fmt::Display>(msg: T) -> Self {
        Error::Message(msg.to_string())
    }
}

impl Serialize for Value {
    fn serialize<S: ser::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let text = crate::write(self).map_err(ser::Error::custom)?;
        serializer.serialize_newtype_struct(RAW_TOKEN, &text)
    }
}

fn present(v: Value) -> Result<Option<Value>> {
    Ok(Some(v))
}

fn number(n: impl ToString) -> Result<Option<Value>> {
    present(Value::Number(n.to_string()))
}

/// Shortest round-trip digits; decimal from 1e-6 up to 1e21, as JS does.
fn float<F: std::fmt::Display + std::fmt::LowerExp + Into<f64> + Copy>(f: F) -> Result<Option<Value>> {
    let wide: f64 = f.into();
    if !wide.is_finite() {
        return Err(Error::InvalidValue("non-finite float".into()));
    }
    let magnitude = wide.abs();
    let spelling = if magnitude == 0.0 || (1e-6..1e21).contains(&magnitude) {
        format!("{f}")
    } else {
        format!("{f:e}")
    };
    debug_assert!(crate::is_number(&spelling), "{spelling}");
    present(Value::Number(spelling))
}

fn tag(name: &str, payload: Option<Value>) -> Value {
    Value::Tag { name: name.into(), attributes: Vec::new(), payload: Box::new(payload.unwrap_or(Value::Null)) }
}

pub struct Serializer;

impl ser::Serializer for Serializer {
    type Ok = Option<Value>;
    type Error = Error;
    type SerializeSeq = Seq;
    type SerializeTuple = Seq;
    type SerializeTupleStruct = Seq;
    type SerializeTupleVariant = Seq;
    type SerializeMap = Map;
    type SerializeStruct = Map;
    type SerializeStructVariant = Map;

    fn serialize_bool(self, v: bool) -> Result<Self::Ok> {
        present(Value::Boolean(v))
    }
    fn serialize_i8(self, v: i8) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_i16(self, v: i16) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_i32(self, v: i32) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_i64(self, v: i64) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_i128(self, v: i128) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_u8(self, v: u8) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_u16(self, v: u16) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_u32(self, v: u32) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_u64(self, v: u64) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_u128(self, v: u128) -> Result<Self::Ok> {
        number(v)
    }
    fn serialize_f32(self, v: f32) -> Result<Self::Ok> {
        float(v)
    }
    fn serialize_f64(self, v: f64) -> Result<Self::Ok> {
        float(v)
    }
    fn serialize_char(self, v: char) -> Result<Self::Ok> {
        present(Value::Text(v.to_string()))
    }
    fn serialize_str(self, v: &str) -> Result<Self::Ok> {
        present(Value::Text(v.into()))
    }
    fn serialize_bytes(self, v: &[u8]) -> Result<Self::Ok> {
        present(Value::Blob(v.into()))
    }
    fn serialize_none(self) -> Result<Self::Ok> {
        Ok(None)
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Self::Ok> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<Self::Ok> {
        present(Value::Null)
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<Self::Ok> {
        present(Value::Null)
    }
    fn serialize_unit_variant(self, _name: &'static str, _index: u32, variant: &'static str) -> Result<Self::Ok> {
        present(tag(variant, None))
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(self, name: &'static str, value: &T) -> Result<Self::Ok> {
        if name == RAW_TOKEN {
            return match value.serialize(self)? {
                Some(Value::Text(text)) => present(crate::parse(text.as_bytes())?),
                _ => Err(Error::Message("raw WON value must be text".into())),
            };
        }
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Self::Ok> {
        present(tag(variant, value.serialize(Serializer)?))
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<Seq> {
        Ok(Seq { variant: None, items: Vec::with_capacity(len.unwrap_or(0)) })
    }
    fn serialize_tuple(self, len: usize) -> Result<Seq> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_struct(self, _name: &'static str, len: usize) -> Result<Seq> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_variant(self, _name: &'static str, _index: u32, variant: &'static str, len: usize) -> Result<Seq> {
        Ok(Seq { variant: Some(variant), items: Vec::with_capacity(len) })
    }
    fn serialize_map(self, _len: Option<usize>) -> Result<Map> {
        Ok(Map { variant: None, fields: Vec::new(), key: None })
    }
    fn serialize_struct(self, _name: &'static str, _len: usize) -> Result<Map> {
        self.serialize_map(None)
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        _len: usize,
    ) -> Result<Map> {
        Ok(Map { variant: Some(variant), fields: Vec::new(), key: None })
    }
}

/// Lists; a tuple variant wraps its list in a tag.
pub struct Seq {
    variant: Option<&'static str>,
    items: Vec<Value>,
}

impl Seq {
    fn push<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        self.items.push(value.serialize(Serializer)?.unwrap_or(Value::Null));
        Ok(())
    }
    fn finish(self) -> Result<Option<Value>> {
        let list = Value::List(self.items);
        present(match self.variant {
            Some(name) => tag(name, Some(list)),
            None => list,
        })
    }
}

macro_rules! seq_impl {
    ($trait:ident, $method:ident) => {
        impl ser::$trait for Seq {
            type Ok = Option<Value>;
            type Error = Error;
            fn $method<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
                self.push(value)
            }
            fn end(self) -> Result<Self::Ok> {
                self.finish()
            }
        }
    };
}
seq_impl!(SerializeSeq, serialize_element);
seq_impl!(SerializeTuple, serialize_element);
seq_impl!(SerializeTupleStruct, serialize_field);
seq_impl!(SerializeTupleVariant, serialize_field);

/// Records; absent values are omitted. A struct variant wraps its record in a tag.
pub struct Map {
    variant: Option<&'static str>,
    fields: Vec<(String, Value)>,
    key: Option<String>,
}

impl Map {
    fn insert(&mut self, key: String, value: Option<Value>) -> Result<()> {
        if let Some(value) = value {
            if self.fields.iter().any(|(k, _)| *k == key) {
                return Err(Error::InvalidValue(format!("duplicate field {key}")));
            }
            self.fields.push((key, value));
        }
        Ok(())
    }
    fn finish(self) -> Result<Option<Value>> {
        let record = Value::Record(self.fields);
        present(match self.variant {
            Some(name) => tag(name, Some(record)),
            None => record,
        })
    }
}

impl ser::SerializeMap for Map {
    type Ok = Option<Value>;
    type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<()> {
        match key.serialize(Serializer)? {
            Some(Value::Text(k)) => {
                self.key = Some(k);
                Ok(())
            }
            _ => Err(Error::Message("WON record keys must be strings".into())),
        }
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<()> {
        let key = self.key.take().expect("serialize_key before serialize_value");
        let value = value.serialize(Serializer)?;
        // A map entry whose value is None stays present as null; only struct fields omit.
        self.insert(key, Some(value.unwrap_or(Value::Null)))
    }
    fn end(self) -> Result<Self::Ok> {
        self.finish()
    }
}

macro_rules! struct_impl {
    ($trait:ident) => {
        impl ser::$trait for Map {
            type Ok = Option<Value>;
            type Error = Error;
            fn serialize_field<T: Serialize + ?Sized>(&mut self, key: &'static str, value: &T) -> Result<()> {
                let value = value.serialize(Serializer)?;
                self.insert(key.into(), value)
            }
            fn end(self) -> Result<Self::Ok> {
                self.finish()
            }
        }
    };
}
struct_impl!(SerializeStruct);
struct_impl!(SerializeStructVariant);

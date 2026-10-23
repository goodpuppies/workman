//! serde features that real Rust code uses, and how they meet WON.
//! Each test pins the observed behavior; markdown/won-ipc.md discusses them.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize, Deserialize, Debug, PartialEq)]
enum Shape {
    Dot,
    Circle { r: f64 },
}

#[test]
fn externally_tagged_enums_are_native_tags() {
    assert_eq!(won::to_string(&vec![Shape::Dot, Shape::Circle { r: 1.5 }]).unwrap(), "[Dot Circle{r = 1.5}]");
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(untagged)]
enum Loose {
    Count(u64),
    Shape(Shape),
}

#[test]
fn untagged_enums() {
    let text = won::to_string(&vec![Loose::Count(3), Loose::Shape(Shape::Dot)]).unwrap();
    assert_eq!(text, "[3 Dot]");
    // serde buffers untagged input in a Content that rejects enum input, so
    // the self-describing path presents a tag as `{Dot: null}`.
    assert_eq!(won::from_str::<Vec<Loose>>(&text).unwrap(), vec![Loose::Count(3), Loose::Shape(Shape::Dot)]);
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "type")]
enum Internal {
    Ping,
    Move { x: i32 },
}

#[test]
fn internally_tagged_enums_become_records() {
    let text = won::to_string(&Internal::Move { x: 1 }).unwrap();
    assert_eq!(text, "{type = \"Move\" x = 1}");
    assert_eq!(won::from_str::<Internal>(&text).unwrap(), Internal::Move { x: 1 });
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Outer {
    name: String,
    #[serde(flatten)]
    rest: BTreeMap<String, won::Value>,
}

#[test]
fn flatten_untyped_values_degrade() {
    // An untyped Value under flatten is rebuilt from serde's JSON-shaped data
    // model: the tag becomes a one-entry record and the spelling is lost.
    let back = won::from_str::<Outer>("{name = \"a\" shape = Circle{r = 1} n = 1.50}").unwrap();
    assert_eq!(won::write(&back.rest["shape"]).unwrap(), "{Circle = {r = 1}}");
    assert_eq!(won::write(&back.rest["n"]).unwrap(), "1.5");
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct FlatShape {
    name: String,
    #[serde(flatten)]
    rest: BTreeMap<String, Shape>,
}

#[test]
fn flatten_typed_tags() {
    let back = won::from_str::<FlatShape>("{name = \"a\" s = Circle{r = 1} t = Dot}").unwrap();
    assert_eq!(back.rest["s"], Shape::Circle { r: 1.0 });
    assert_eq!(back.rest["t"], Shape::Dot);
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(untagged)]
enum Wide {
    Big(u128),
    Exact(f64),
}

#[test]
fn untagged_numbers() {
    // serde's Content has no 128-bit case, so this fails only when buffered.
    assert!(won::from_str::<Wide>("340282366920938463463374607431768211455").is_err());
    assert_eq!(won::from_str::<u128>("340282366920938463463374607431768211455").unwrap(), u128::MAX);
    assert_eq!(won::from_str::<Wide>("1.50").unwrap(), Wide::Exact(1.5));
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "type")]
enum InternalWithTag {
    Draw { shape: Shape },
}

#[test]
fn internally_tagged_with_inner_tag() {
    let text = won::to_string(&InternalWithTag::Draw { shape: Shape::Dot }).unwrap();
    assert_eq!(text, "{type = \"Draw\" shape = Dot}");
    assert_eq!(won::from_str::<InternalWithTag>(&text).unwrap(), InternalWithTag::Draw { shape: Shape::Dot });
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Bytes {
    plain: Vec<u8>,
    #[serde(with = "serde_bytes")]
    marked: Vec<u8>,
}

#[test]
fn bytes_need_serde_bytes() {
    let text = won::to_string(&Bytes { plain: vec![0, 255], marked: vec![0, 255] }).unwrap();
    assert_eq!(text, "{plain = [0 255] marked = x\"00ff\"}");
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Strict {
    a: u8,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
struct Stricter {
    a: u8,
}

#[test]
fn unknown_fields_follow_the_type_not_the_format() {
    assert_eq!(won::from_str::<Strict>("{a = 1 b = 2}").unwrap(), Strict { a: 1 });
    assert!(won::from_str::<Stricter>("{a = 1 b = 2}").is_err());
}

#[test]
fn map_keys() {
    let mut by_name = BTreeMap::new();
    by_name.insert("x y".to_string(), 1);
    assert_eq!(won::to_string(&by_name).unwrap(), "{\"x y\" = 1}");
    let mut by_number = HashMap::new();
    by_number.insert(7u32, "seven");
    assert!(won::to_string(&by_number).is_err());
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Nested {
    maybe: Option<Option<u8>>,
}

#[test]
fn nested_options_collapse() {
    let text = won::to_string(&Nested { maybe: Some(None) }).unwrap();
    assert_eq!(text, "{}");
    assert_eq!(won::from_str::<Nested>(&text).unwrap(), Nested { maybe: None });
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct AppConfig {
    port: u16,
}

#[test]
fn struct_may_arrive_in_a_named_tag() {
    assert_eq!(won::from_str::<AppConfig>("AppConfig{port = 80}").unwrap(), AppConfig { port: 80 });
    assert!(won::from_str::<AppConfig>("Other{port = 80}").is_err());
}

#[test]
fn integers_and_floats() {
    assert!(won::from_str::<u64>("1e3").is_err());
    assert!(won::from_str::<u8>("256").is_err());
    assert!(won::from_str::<f64>("1e400").is_err());
    assert_eq!(won::from_str::<f32>("0.1").unwrap(), 0.1f32);
    assert_eq!(won::to_string(&0.1f32).unwrap(), "0.1");
    assert!(won::to_string(&f64::NAN).is_err());
}

#[test]
fn attributes_have_no_typed_home() {
    assert!(won::from_str::<Shape>("Dot<id = 1>").is_err());
}

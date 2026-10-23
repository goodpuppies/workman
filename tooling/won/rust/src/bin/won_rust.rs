//! `won-rust normalize`: canonical WON for one stdin document, as the WM probe does.
use std::io::{Read, Write};

fn main() {
    let mut source = Vec::new();
    std::io::stdin().read_to_end(&mut source).unwrap();
    match won::parse(&source).and_then(|v| won::write(&v)) {
        Ok(text) => println!("{text}"),
        Err(e) => {
            writeln!(std::io::stderr(), "{e}").unwrap();
            std::process::exit(1);
        }
    }
}

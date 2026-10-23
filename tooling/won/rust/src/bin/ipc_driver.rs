//! Spawns the Zig peer and exchanges typed envelopes, one canonical WON
//! document per line. Every line sent and received is appended to a transcript
//! so the WM implementation can check it independently.
//!
//! usage: ipc-driver <won-zig-peer> [transcript]
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Instant;
use won::Value;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Hand {
    Left,
    Right,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct Pose {
    hand: Hand,
    position: [f64; 3],
    rotation: [f64; 4],
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
enum Request {
    Ping,
    Echo(Value),
    Health,
    SetPose(Pose),
    Frame {
        width: u32,
        height: u32,
        #[serde(with = "serde_bytes")]
        pixels: Vec<u8>,
    },
    Rename { from: String, to: Option<String> },
    Floats(Vec<f64>),
    Wide { big: u128, small: i64, ch: char },
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
enum Response {
    Pong,
    Echoed(Value),
    Health { run_frame_count: u64, ipc_sessions: u32, uptime: f64 },
    Ack,
    FrameStats { bytes: u64, checksum: u32 },
    Renamed { from: String, to: Option<String> },
    Floats(Vec<f64>),
    Wide { big: u128, small: i64, ch: char },
    Error { message: String, event: String },
}

#[derive(Serialize, Deserialize, Debug)]
struct Envelope<T> {
    id: u64,
    body: T,
}

struct Peer {
    child: std::process::Child,
    input: std::process::ChildStdin,
    output: BufReader<std::process::ChildStdout>,
    transcript: Option<std::fs::File>,
}

impl Peer {
    /// Send one raw line and return the raw reply line.
    fn exchange(&mut self, line: &str) -> String {
        assert!(!line.contains('\n'), "canonical WON must fit line framing");
        writeln!(self.input, "{line}").unwrap();
        self.input.flush().unwrap();
        let mut reply = String::new();
        self.output.read_line(&mut reply).unwrap();
        let reply = reply.strip_suffix('\n').expect("peer closed the stream").to_string();
        if let Some(t) = &mut self.transcript {
            writeln!(t, "{line}\n{reply}").unwrap();
        }
        reply
    }

    fn call(&mut self, id: u64, body: &Request) -> (Response, String) {
        let reply = self.exchange(&won::to_string(&Envelope { id, body }).unwrap());
        let envelope: Envelope<Response> =
            won::from_str(&reply).unwrap_or_else(|e| panic!("cannot read reply {reply}: {e}"));
        assert_eq!(envelope.id, id, "{reply}");
        (envelope.body, reply)
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut child = Command::new(&args[1]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    let mut peer = Peer {
        input: child.stdin.take().unwrap(),
        output: BufReader::new(child.stdout.take().unwrap()),
        child,
        transcript: args.get(2).map(|p| std::fs::File::create(p).unwrap()),
    };
    let mut checks = 0;
    let mut check = |ok: bool, what: &str| {
        assert!(ok, "{what}");
        checks += 1;
    };

    let (r, _) = peer.call(1, &Request::Ping);
    check(r == Response::Pong, "ping");

    // Untyped data crosses both typed layers unchanged, spelling and all.
    let mixed = won::parse(
        "Mixed<id = 1>[\"text\\n\\\"q\\\" \\x00 😀\" x\"00ff\" 1E+5 -0 1.50 \
         {\"odd key\" = null nested = [Ready Inner(Deep{a = 1})]}]"
            .as_bytes(),
    )
    .unwrap();
    let (r, _) = peer.call(2, &Request::Echo(mixed.clone()));
    check(r == Response::Echoed(mixed), "untyped echo");
    let (r, reply) = peer.call(3, &Request::Echo(Value::Null));
    check(r == Response::Echoed(Value::Null) && reply.contains("body = Echoed}"), "null payload is a bare tag");

    let (r, _) = peer.call(4, &Request::Health);
    check(
        r == Response::Health { run_frame_count: u64::MAX, ipc_sessions: 2, uptime: 0.1 },
        "u64 counters survive",
    );

    let pose = Pose { hand: Hand::Left, position: [0.1, -0.0, 1.5], rotation: [0.0, 0.0, 0.0, 1.0] };
    let (r, _) = peer.call(5, &Request::SetPose(pose.clone()));
    check(r == Response::Ack, "pose");
    let (r, _) = peer.call(6, &Request::SetPose(Pose { rotation: [0.0; 4], ..pose }));
    check(
        r == Response::Error { message: "InvalidRotation".into(), event: "set-pose".into() },
        "application error variant",
    );

    let pixels: Vec<u8> = (0..256 * 256 * 4).map(|i| (i * 7 % 256) as u8).collect();
    let checksum = pixels.iter().fold(0u32, |a, &b| a.wrapping_add(b as u32));
    let started = Instant::now();
    let line = won::to_string(&Envelope { id: 7, body: Request::Frame { width: 256, height: 256, pixels } }).unwrap();
    let reply = peer.exchange(&line);
    let elapsed = started.elapsed();
    let r: Envelope<Response> = won::from_str(&reply).unwrap();
    check(r.body == Response::FrameStats { bytes: 262144, checksum }, "frame blob");
    eprintln!("frame: {} byte line for 262144 pixel bytes, {:?} round trip", line.len(), elapsed);

    let (r, _) = peer.exchange_rename(8, None);
    check(r == Response::Renamed { from: "a".into(), to: None }, "absent optional");
    let (r, _) = peer.exchange_rename(9, Some(String::new()));
    check(r == Response::Renamed { from: "a".into(), to: Some(String::new()) }, "present empty optional");

    // Float spellings from Rust and Zig must agree for canonical output to be shared.
    let floats = vec![0.1, -0.0, 1.0, 1e20, 1e21, 5e-324, f64::MAX, 1e-7, 123456.789, f64::EPSILON, 1.5e300, 2.5e-5];
    let (r, reply) = peer.call(10, &Request::Floats(floats.clone()));
    let Response::Floats(back) = r else { panic!("{reply}") };
    check(back.iter().map(|f| f.to_bits()).eq(floats.iter().map(|f| f.to_bits())), "float bits");
    let ours = won::to_string(&floats).unwrap();
    let theirs = won::write(won::parse(reply.as_bytes()).unwrap().get("body").map(payload).unwrap()).unwrap();
    check(ours == theirs, &format!("float spellings differ:\n rust {ours}\n zig  {theirs}"));

    let wide = Request::Wide { big: u128::MAX, small: i64::MIN, ch: '😀' };
    let (r, _) = peer.call(11, &wide);
    check(r == Response::Wide { big: u128::MAX, small: i64::MIN, ch: '😀' }, "wide integers and char");

    // Failures are replies, not crashes: malformed text and an unknown variant.
    let reply = peer.exchange("{id = 12 body = ");
    check(reply.starts_with("{id = 0 body = Error{message = \"byte "), &reply);
    let reply = peer.exchange("{id = 13 body = Reboot}");
    check(reply == "{id = 13 body = Error{message = \"UnknownTag\" event = \"decode\"}}", &reply);

    drop(peer.input);
    let status = peer.child.wait().unwrap();
    check(status.success(), "peer exit");
    println!("PASS: {checks} Rust/Zig IPC checks");
}

impl Peer {
    fn exchange_rename(&mut self, id: u64, to: Option<String>) -> (Response, String) {
        let request = Request::Rename { from: "a".into(), to: to.clone() };
        let line = won::to_string(&Envelope { id, body: &request }).unwrap();
        // An absent optional is omitted, never written as null.
        assert_eq!(line.contains("to = "), to.is_some(), "{line}");
        let reply = self.exchange(&line);
        (won::from_str::<Envelope<Response>>(&reply).unwrap().body, reply)
    }
}

fn payload(v: &Value) -> &Value {
    match v {
        Value::Tag { payload, .. } => payload,
        other => panic!("expected a tag, found {other:?}"),
    }
}

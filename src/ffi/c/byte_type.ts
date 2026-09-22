// Compile-time byte_type bridge for C codec validation.
//
// The emitter composes the same codec descriptors it emits and checks
// byte_type's own field-offset math against the extractor's offsets (the
// C-layout authority). Static import: the dependency is fixed at author time
// via the deno.json "byte_type" import mapping.

import { bool, createSizedStruct, f32, f64, i16, i32, i64, i8, u16, u32, u64, u8 } from "byte_type";

const CODEC_BY_NAME: Record<string, unknown> = {
  bool,
  i8,
  i16,
  i32,
  i64,
  u8,
  u16,
  u32,
  u64,
  f32,
  f64,
};

export type CCodecField = {
  name: string;
  offset: number;
  /** byte_type primitive name: u8..u64, i8..i64, f32, f64, bool. */
  codec: string;
};

export type CCodecDescriptor = {
  name: string;
  size: number;
  align: number;
  fields: CCodecField[];
};

export function validateCodecDescriptor(descriptor: CCodecDescriptor): void {
  const fields: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    const codec = CODEC_BY_NAME[field.codec];
    if (!codec) throw new Error(`no byte_type codec for '${field.codec}'`);
    fields[field.name] = codec;
  }
  const codec = createSizedStruct(fields);
  const offsets = codec.getFieldOffsets() as Record<string, number>;
  for (const field of descriptor.fields) {
    if (offsets[field.name] !== field.offset) {
      throw new Error(
        `C struct ${descriptor.name} field ${field.name}: extracted offset ${field.offset} != byte_type offset ${
          offsets[field.name]
        }`,
      );
    }
  }
  if (codec.byteSize !== descriptor.size) {
    throw new Error(
      `C struct ${descriptor.name}: extracted size ${descriptor.size} != byte_type size ${codec.byteSize}`,
    );
  }
}

struct EdgeData { unsigned char bytes[17]; int count; };
typedef struct EdgeWide { unsigned long long value; long long signed_value; } EdgeWide;
#define EXACT_UNSIGNED (18446744073709551615ULL)
#define EXACT_SIGNED (-9223372036854775807LL)
#define EXACT_RECORD ((EdgeWide){18446744073709551615ULL, -9223372036854775807LL})
typedef union EdgeChoice { unsigned int word; unsigned char bytes[4]; } EdgeChoice;
typedef struct EdgeNested {
    unsigned char prefix;
    struct { unsigned short port; EdgeChoice choice; } inner;
    unsigned long long tail;
} EdgeNested;
typedef struct EdgeIntegers {
    unsigned char u8;
    unsigned short u16;
    unsigned int u32;
    signed char i8;
    short i16;
    int i32;
} EdgeIntegers;
#define EDGE_U8 ((unsigned char)255)
#define EDGE_U16 ((unsigned short)65535)
#define EDGE_U32 ((unsigned int)4294967295U)

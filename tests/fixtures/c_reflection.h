typedef struct Aligned { unsigned char tag; double value; int samples[3]; } Aligned;
typedef struct Opaque Opaque;
typedef enum Mode { MODE_ZERO, MODE_SEVEN = 7, MODE_EIGHT } Mode;
int consume(const Aligned *value, Opaque *opaque, Mode mode);
#define ANSWER (6 * 7)
#define SCALE 1.5
#define COLOUR ((Aligned){ .tag = 9, .value = 2.5, .samples = {1, 2, 3} })

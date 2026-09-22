#include "vec3.h"
float dot3(Vector3 *a, Vector3 *b) {
  return a->x * b->x + a->y * b->y + a->z * b->z;
}
float v2dot(V2 a, V2 b) { return a.x*b.x + a.y*b.y; }

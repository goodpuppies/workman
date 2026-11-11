import { enabled, identity, Numbers, twice } from "./facade.wm";

const result: number = twice(21);
const text: string = identity("hello");
const nested: number = Numbers.double(10);
const active: boolean = enabled;

// @ts-expect-error ordinary WM imports remain private
import { privateToFacade } from "./facade.wm";
// @ts-expect-error the original WM argument type is retained through the re-export
twice("wrong");

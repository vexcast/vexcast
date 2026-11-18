import type { studioEs } from "./studio.es";

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? Widen<U>[] : { [K in keyof T]: Widen<T[K]> };
export type StudioDict = Widen<typeof studioEs>;

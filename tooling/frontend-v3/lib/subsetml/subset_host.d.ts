// Types for subset_host.js, read by Workman's FFI reflection. Every call may throw a Latin-1 message.
export declare const readFile: (path: string) => string;
export declare const canonicalPath: (path: string) => string;
export declare const writeFile: (data: string, path: string) => void;
export declare const writeStdout: (data: string) => void;
export declare const writeStderr: (data: string) => void;
declare const processArguments: () => string[];
export { processArguments as arguments };
export declare const exit: (success: boolean) => void;

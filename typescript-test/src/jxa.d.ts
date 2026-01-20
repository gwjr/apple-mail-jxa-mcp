// Type declarations for JXA (JavaScript for Automation) runtime
// These globals are provided by osascript -l JavaScript

// Application function - creates scriptable app references
interface ApplicationFunction {
  (name: string): any;
  currentApplication(): CurrentApplication;
}
declare const Application: ApplicationFunction;

interface CurrentApplication {
  includeStandardAdditions: boolean;
  doShellScript(command: string, options?: { administratorPrivileges?: boolean }): string;
}

// Objective-C bridge
declare const ObjC: {
  import(framework: string): void;
  unwrap<T>(objcValue: any): T;
  wrap<T>(jsValue: T): any;
  castRefToObject(ref: any): any;
  bindFunction(name: string, lib: any, types: string[]): void;
  registerSubclass(config: ObjCSubclassConfig): any;
};

interface ObjCSubclassConfig {
  name: string;
  superclass?: string;
  protocols?: string[];
  methods?: {
    [methodName: string]: {
      types: (string | string[])[];  // e.g., ["void", ["id"]]
      implementation: (...args: any[]) => any;
    };
  };
}

// The $ global provides access to Objective-C classes and functions
// after ObjC.import() has been called
interface ObjCBridge {
  // Foundation classes
  NSFileHandle: NSFileHandleClass;
  NSString: NSStringClass;
  NSData: NSDataClass;
  NSRunLoop: NSRunLoopClass;
  NSDate: NSDateClass;
  NSNotificationCenter: NSNotificationCenterClass;
  NSProcessInfo: NSProcessInfoClass;
  NSUTF8StringEncoding: number;

  // Selectors
  sel(selectorName: string): any;

  // Allow any other ObjC class access
  [className: string]: any;
}

declare const $: ObjCBridge;

// NSFileHandle
interface NSFileHandleClass {
  fileHandleWithStandardInput: NSFileHandle;
  fileHandleWithStandardOutput: NSFileHandle;
  fileHandleWithStandardError: NSFileHandle;
  alloc: { init: () => NSFileHandle };
}

interface NSFileHandle {
  availableData: NSData;
  readDataOfLength(length: number): NSData;
  writeData(data: NSData): void;
  readabilityHandler: ((handle: NSFileHandle) => void) | null;
  waitForDataInBackgroundAndNotify: void;  // Property getter, not a method
  fileDescriptor: number;
}

// NSString
interface NSStringClass {
  alloc: {
    initWithDataEncoding(data: NSData, encoding: number): NSString;
  };
  stringWithString(str: string): NSString;
}

interface NSString {
  js: string;
  UTF8String: string;
  length: number;
  dataUsingEncoding(encoding: number): NSData;
}

// NSData
interface NSDataClass {
  alloc: { init: () => NSData };
  dataWithContentsOfFile(path: string): NSData;
}

interface NSData {
  length: number;
  bytes: any;
  js: ArrayBuffer;
}

// NSRunLoop
interface NSRunLoopClass {
  currentRunLoop: NSRunLoop;
  mainRunLoop: NSRunLoop;
}

interface NSRunLoop {
  runUntilDate(date: NSDate): void;
  runMode_beforeDate(mode: string, date: NSDate): boolean;
}

// NSDate
interface NSDateClass {
  date: NSDate;
  dateWithTimeIntervalSinceNow(seconds: number): NSDate;
  distantFuture: NSDate;
}

interface NSDate {
  timeIntervalSinceNow: number;
}

// NSNotificationCenter
interface NSNotificationCenterClass {
  defaultCenter: NSNotificationCenter;
}

interface NSNotificationCenter {
  addObserverSelectorNameObject(
    observer: any,
    selector: any,
    name: string | null,
    object: any | null
  ): void;
  removeObserver(observer: any): void;
}

// NSProcessInfo
interface NSProcessInfoClass {
  processInfo: {
    environment: {
      objectForKey(key: string): NSString | null;
    };
  };
}

// Ref wrapper for pass-by-reference
declare function Ref<T = any>(initialValue?: T): { "0": T };

// Path functions
declare function Path(path: string): any;

// delay function (JXA built-in)
declare function delay(seconds: number): void;

// Console (JXA provides basic console)
interface Console {
  log(...args: any[]): void;
}
declare const console: Console;

"use strict";
/** Minimal bun:ffi stub for Node/jiti — enough for @oh-my-pi/pi-utils import graph. */
const FFIType = {
  void: 0,
  i8: 1,
  i16: 2,
  i32: 3,
  i64: 4,
  u8: 5,
  u16: 6,
  u32: 7,
  u64: 8,
  f32: 9,
  f64: 10,
  pointer: 11,
  cstring: 12,
  function: 13,
  bool: 14,
  char: 15,
  ptr: 11,
};
function dlopen() {
  const unavailable = () => {
    throw new Error("bun:ffi is unavailable under Node Bun-shim (Pi/jiti host)");
  };
  return new Proxy(
    {},
    {
      get() {
        return unavailable;
      },
    },
  );
}
function ptr(x) {
  return x;
}
function CString(x) {
  return String(x ?? "");
}
module.exports = { dlopen, FFIType, ptr, CString, suffix: process.platform === "darwin" ? "dylib" : "so" };

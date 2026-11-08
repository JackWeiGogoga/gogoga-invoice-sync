// esbuild 用 binary loader 把 .bcmap 打成 Uint8Array
declare module "*.bcmap" {
  const data: Uint8Array;
  export default data;
}

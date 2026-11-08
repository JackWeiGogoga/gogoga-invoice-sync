/**
 * pdf.js 自带的简体中文预置 CMap，打包进插件。
 *
 * 不少数电票 PDF 用未嵌入的 STSong-Light + UniGB-UCS2-H 写号码、日期、名称和金额，
 * 没有对应 CMap 时 pdf.js 加载不了这个字体，这些文字会整段丢失。
 * 只带 GB 系列（约 290KB），繁体 / 日韩编码在发票里用不到。
 */
import c0 from "pdfjs-dist/cmaps/Adobe-GB1-0.bcmap";
import c1 from "pdfjs-dist/cmaps/Adobe-GB1-1.bcmap";
import c2 from "pdfjs-dist/cmaps/Adobe-GB1-2.bcmap";
import c3 from "pdfjs-dist/cmaps/Adobe-GB1-3.bcmap";
import c4 from "pdfjs-dist/cmaps/Adobe-GB1-4.bcmap";
import c5 from "pdfjs-dist/cmaps/Adobe-GB1-5.bcmap";
import c6 from "pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap";
import c7 from "pdfjs-dist/cmaps/GB-EUC-H.bcmap";
import c8 from "pdfjs-dist/cmaps/GB-EUC-V.bcmap";
import c9 from "pdfjs-dist/cmaps/GB-H.bcmap";
import c10 from "pdfjs-dist/cmaps/GB-V.bcmap";
import c11 from "pdfjs-dist/cmaps/GBK-EUC-H.bcmap";
import c12 from "pdfjs-dist/cmaps/GBK-EUC-V.bcmap";
import c13 from "pdfjs-dist/cmaps/GBK2K-H.bcmap";
import c14 from "pdfjs-dist/cmaps/GBK2K-V.bcmap";
import c15 from "pdfjs-dist/cmaps/GBKp-EUC-H.bcmap";
import c16 from "pdfjs-dist/cmaps/GBKp-EUC-V.bcmap";
import c17 from "pdfjs-dist/cmaps/GBT-EUC-H.bcmap";
import c18 from "pdfjs-dist/cmaps/GBT-EUC-V.bcmap";
import c19 from "pdfjs-dist/cmaps/GBT-H.bcmap";
import c20 from "pdfjs-dist/cmaps/GBT-V.bcmap";
import c21 from "pdfjs-dist/cmaps/GBTpc-EUC-H.bcmap";
import c22 from "pdfjs-dist/cmaps/GBTpc-EUC-V.bcmap";
import c23 from "pdfjs-dist/cmaps/GBpc-EUC-H.bcmap";
import c24 from "pdfjs-dist/cmaps/GBpc-EUC-V.bcmap";
import c25 from "pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap";
import c26 from "pdfjs-dist/cmaps/UniGB-UCS2-V.bcmap";
import c27 from "pdfjs-dist/cmaps/UniGB-UTF16-H.bcmap";
import c28 from "pdfjs-dist/cmaps/UniGB-UTF16-V.bcmap";
import c29 from "pdfjs-dist/cmaps/UniGB-UTF32-H.bcmap";
import c30 from "pdfjs-dist/cmaps/UniGB-UTF32-V.bcmap";
import c31 from "pdfjs-dist/cmaps/UniGB-UTF8-H.bcmap";
import c32 from "pdfjs-dist/cmaps/UniGB-UTF8-V.bcmap";

export const GB_CMAPS: Record<string, Uint8Array> = {
  "Adobe-GB1-0.bcmap": c0,
  "Adobe-GB1-1.bcmap": c1,
  "Adobe-GB1-2.bcmap": c2,
  "Adobe-GB1-3.bcmap": c3,
  "Adobe-GB1-4.bcmap": c4,
  "Adobe-GB1-5.bcmap": c5,
  "Adobe-GB1-UCS2.bcmap": c6,
  "GB-EUC-H.bcmap": c7,
  "GB-EUC-V.bcmap": c8,
  "GB-H.bcmap": c9,
  "GB-V.bcmap": c10,
  "GBK-EUC-H.bcmap": c11,
  "GBK-EUC-V.bcmap": c12,
  "GBK2K-H.bcmap": c13,
  "GBK2K-V.bcmap": c14,
  "GBKp-EUC-H.bcmap": c15,
  "GBKp-EUC-V.bcmap": c16,
  "GBT-EUC-H.bcmap": c17,
  "GBT-EUC-V.bcmap": c18,
  "GBT-H.bcmap": c19,
  "GBT-V.bcmap": c20,
  "GBTpc-EUC-H.bcmap": c21,
  "GBTpc-EUC-V.bcmap": c22,
  "GBpc-EUC-H.bcmap": c23,
  "GBpc-EUC-V.bcmap": c24,
  "UniGB-UCS2-H.bcmap": c25,
  "UniGB-UCS2-V.bcmap": c26,
  "UniGB-UTF16-H.bcmap": c27,
  "UniGB-UTF16-V.bcmap": c28,
  "UniGB-UTF32-H.bcmap": c29,
  "UniGB-UTF32-V.bcmap": c30,
  "UniGB-UTF8-H.bcmap": c31,
  "UniGB-UTF8-V.bcmap": c32,
};

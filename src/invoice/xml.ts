/**
 * 极简 XML 解析：只要元素树和文本，忽略属性与命名空间前缀。
 *
 * 不用 DOMParser 是为了让同一份代码能在 Node 里跑测试；
 * 数电票 XML 结构简单（纯元素嵌套、无混排文本），这点能力足够。
 */

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ent] ?? whole;
  });
}

/** 去掉 `ns:` 前缀，便于按本地名查找。 */
function localName(tag: string): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(i + 1);
}

/** 按 XML 声明里的编码解码字节；数电票基本是 UTF-8，少数平台用 GBK。 */
export function decodeXmlBytes(data: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(data.subarray(0, 200));
  const enc = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(enc === "gb2312" ? "gbk" : enc).decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

export function parseXml(src: string): XmlNode | null {
  const root: XmlNode = { name: "#root", children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1] as XmlNode;
    if (lt === -1) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      top.text += src.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
    } else if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt + 2);
      const name = localName(src.slice(lt + 2, end === -1 ? n : end).trim());
      // 容错：弹到同名元素为止，标签不配对也不至于整体失败
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if ((stack[k] as XmlNode).name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? n : end + 1;
    } else {
      // 属性值里可能有 >，按引号配对找真正的结束位置
      let j = lt + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j += 1;
      }
      const inner = src.slice(lt + 1, j);
      const selfClose = inner.endsWith("/");
      const name = localName(/^[^\s/>]+/.exec(inner)?.[0] ?? "");
      const node: XmlNode = { name, children: [], text: "" };
      top.children.push(node);
      if (!selfClose) stack.push(node);
      i = j + 1;
    }
  }

  const first = root.children[0];
  if (!first) return null;
  trimTexts(first);
  return first;
}

function trimTexts(node: XmlNode): void {
  node.text = node.text.trim();
  for (const c of node.children) trimTexts(c);
}

/** 按路径取第一个子节点，路径用 `/` 分隔。 */
export function child(node: XmlNode | undefined, path: string): XmlNode | undefined {
  let cur = node;
  for (const seg of path.split("/")) {
    if (!cur) return undefined;
    cur = cur.children.find((c) => c.name === seg);
  }
  return cur;
}

/** 按路径取文本，取不到返回空串。 */
export function text(node: XmlNode | undefined, path: string): string {
  return child(node, path)?.text ?? "";
}

/** 所有同名直接子节点。 */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

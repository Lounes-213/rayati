/** Minimal DOM helpers — a whole UI without a framework, ~1 KB of code. */

export type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  /** Trusted markup only (inline SVG built in code). */
  html?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) node.dataset[key] = value;
  }
  if (props.style) Object.assign(node.style, props.style);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (props.on) {
    for (const [key, handler] of Object.entries(props.on)) {
      node.addEventListener(key, handler as EventListener);
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Screen scaffold: `.screen > .screen__inner`. */
export function screenShell(options: { center?: boolean; testId?: string } = {}): {
  screen: HTMLElement;
  inner: HTMLElement;
} {
  const inner = el('div', { class: 'screen__inner' });
  const screen = el(
    'section',
    {
      class: `screen${options.center ? ' screen--center' : ''}`,
      attrs: options.testId ? { 'data-screen': options.testId } : undefined,
    },
    inner,
  );
  return { screen, inner };
}

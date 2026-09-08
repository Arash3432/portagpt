import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownLite } from "../app/ui/markdown";

function render(text: string) {
  return renderToStaticMarkup(createElement(MarkdownLite, { text, locale: "en" }));
}

test("markdown links preserve the intended label and use the actual HTTP destination", () => {
  const html = render("Read [the documentation](https://example.com/docs?q=1&lang=en).");
  assert.match(html, /href="https:\/\/example\.com\/docs\?q=1&amp;lang=en"/);
  assert.match(html, />the documentation<\/a>/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.doesNotMatch(html, /href="the documentation"/);
});

test("a dangerous markdown label cannot become a navigation destination", () => {
  const html = render("[javascript:alert(1)](https://safe.example/document)");
  assert.match(html, /href="https:\/\/safe\.example\/document"/);
  assert.match(html, />javascript:alert\(1\)<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test("unsafe or misleading markdown destinations stay inert text", () => {
  for (const source of [
    "[click](javascript:alert(1))",
    "[click](data:text/html;base64,PHNjcmlwdD4=)",
    "[click](vbscript:msgbox(1))",
    "[click](//evil.example)",
    "[click](https://trusted.example@evil.example/path)",
    "[click](https://)",
  ]) {
    assert.doesNotMatch(render(source), /<a\b/, source);
  }
});

test("assistant HTML, scripts, image handlers and code are escaped without execution", () => {
  const html = render('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n\n```html\n<iframe src="javascript:alert(1)"></iframe>\n```');
  assert.doesNotMatch(html, /<(script|img|iframe)\b/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<code>&lt;iframe/);
});

test("tables produce semantic cells with alignment, escaped pipes and safe inline formatting", () => {
  const html = render('| Tool | Count | Note |\n| :--- | ---: | :---: |\n| **Portal** | 12 | A\\|B |\n| [Docs](https://example.com) | 3 | `a|b` |');
  assert.match(html, /<table class="md-table">/);
  assert.equal((html.match(/<th scope="col"/g) || []).length, 3);
  assert.equal((html.match(/<td\b/g) || []).length, 6);
  assert.match(html, /style="text-align:right">Count/);
  assert.match(html, /<strong>Portal<\/strong>/);
  assert.match(html, />A\|B<\/td>/);
  assert.match(html, /<code class="md-inline-code">a\|b<\/code>/);
  assert.match(html, /role="region" tabindex="0"/);
});

test("invalid table delimiters stay readable and short rows keep the header column count", () => {
  assert.doesNotMatch(render('| A | B |\n| --- |\n| x | y |'), /<table\b/);
  const html = render('| A | B |\n| --- | --- |\n| only |');
  assert.equal((html.match(/<td\b/g) || []).length, 2);
});

test("an in-progress streamed code fence renders readable literal code", () => {
  const html = render('```javascript\nconst safe = "<script>";\n');
  assert.match(html, /<pre tabindex="0" aria-label="javascript">/);
  assert.match(html, /const safe = &quot;&lt;script&gt;&quot;;/);
  assert.match(html, /aria-label="Copy code"/);
});

test("long and tilde fences preserve nested shorter fences as code", () => {
  const html = render('````md\n```js\nconst value = 1;\n```\n````\n\n~~~txt\nsecond block\n~~~');
  assert.equal((html.match(/class="md-code"/g) || []).length, 2);
  assert.match(html, /<code>```js\nconst value = 1;\n```<\/code>/);
  assert.match(html, /<code>second block<\/code>/);
});

test("ordered lists preserve their starting number and paragraph separators render correctly", () => {
  const html = render('8. Eight\n9. Nine\n\nParagraph\n---\nNext');
  assert.match(html, /<ol class="md-list md-ol" start="8">/);
  assert.match(html, /<p class="md-p">Paragraph<\/p><hr class="md-hr"\/>/);
});

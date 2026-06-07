"use client";

/**
 * 分享故事用的富文本編輯器 (Tiptap)。
 *
 * 工具列對應 ForeverMissed「Share a story」:粗體 / 斜體 / 底線 / 文字對齊 /
 * 項目清單 / 編號清單 / 縮排(引用)/ 水平線 / 連結 / 清除格式。輸出 HTML 字串
 * (透過 onChange),StoryBoard 拿去送後端;渲染時前端會用 DOMPurify 淨化。
 *
 * Next 14 App Router 注意:Tiptap SSR 要 immediatelyRender:false 避免水合不一致。
 */
import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Link2,
  Eraser,
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  accent: string;
  text: string;
}

export function RichTextEditor({
  value,
  onChange,
  accent,
  text,
}: RichTextEditorProps): React.ReactElement {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "tiptap-content min-h-[180px] px-3 py-2 focus:outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      // 空狀態 Tiptap 會給 "<p></p>";視為空字串。
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // 外部 value 被重置 (例如送出後清空) 時同步進編輯器。
  React.useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "<p></p>";
    if (current !== next && (value === "" || current === "<p></p>")) {
      editor.commands.setContent(next);
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        className="min-h-[220px] rounded-md border"
        style={{ borderColor: `${accent}40` }}
      />
    );
  }

  const setLink = (): void => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("輸入連結網址", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: `${accent}40` }}>
      {/* 工具列 */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
        style={{ borderColor: `${accent}26` }}
      >
        <TBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體">
          <Bold className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體">
          <Italic className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線">
          <UnderlineIcon className="h-4 w-4" />
        </TBtn>
        <Divider accent={accent} />
        <TBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="靠左">
          <AlignLeft className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="置中">
          <AlignCenter className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="靠右">
          <AlignRight className="h-4 w-4" />
        </TBtn>
        <Divider accent={accent} />
        <TBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="項目清單">
          <List className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="編號清單">
          <ListOrdered className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用 / 縮排">
          <Quote className="h-4 w-4" />
        </TBtn>
        <Divider accent={accent} />
        <TBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分隔線">
          <Minus className="h-4 w-4" />
        </TBtn>
        <TBtn active={editor.isActive("link")} onClick={setLink} title="連結">
          <Link2 className="h-4 w-4" />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="清除格式">
          <Eraser className="h-4 w-4" />
        </TBtn>
      </div>

      <div style={{ color: text }}>
        <EditorContent editor={editor} />
      </div>

      {/* tiptap 內容區的基本排版樣式 */}
      <style jsx global>{`
        .tiptap-content p { margin: 0 0 0.5em; }
        .tiptap-content ul { list-style: disc; padding-left: 1.4em; margin: 0.4em 0; }
        .tiptap-content ol { list-style: decimal; padding-left: 1.4em; margin: 0.4em 0; }
        .tiptap-content blockquote { border-left: 3px solid ${accent}; padding-left: 0.9em; margin: 0.5em 0; color: ${accent}; }
        .tiptap-content h2 { font-size: 1.25em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .tiptap-content h3 { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.3em; }
        .tiptap-content a { color: ${accent}; text-decoration: underline; }
        .tiptap-content hr { border: none; border-top: 1px solid ${accent}55; margin: 0.8em 0; }
      `}</style>
    </div>
  );
}

function TBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded p-1.5 text-ink transition-colors ${active ? "bg-ink/10" : "hover:bg-ink/5"}`}
    >
      {children}
    </button>
  );
}

function Divider({ accent }: { accent: string }): React.ReactElement {
  return <span className="mx-1 h-5 w-px" style={{ background: `${accent}33` }} aria-hidden />;
}

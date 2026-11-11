import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Markdown з формулами (KaTeX) і блоками коду. HTML у тексті не виконується.
export default function Markdown({ children, className = "" }) {
  return (
    <div className={`prose-unipars ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{ a: ({ node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}

import { useLayoutEffect, useRef, useState } from 'react';

export default function ExpandableNoteText({ text, className = '' }: { text: string; className?: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    setTruncated(element.scrollHeight > element.clientHeight + 1);
  }, [text]);

  return (
    <div>
      <p ref={textRef} className={`${className} ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="mt-1 text-[10px] font-bold text-[#EE6C4D]"
          aria-expanded={expanded}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}

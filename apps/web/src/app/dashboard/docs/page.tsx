'use client';

import { useState } from 'react';
import { documentationContent, DocCategory, DocSection } from './content';

// Style for inline code/technical terms
const codeStyle = 'bg-gray-700/60 text-blue-400 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-600';

// Auto-detect and style technical terms
function styleTechnicalTerms(text: string): string {
  if (text.includes('`')) return text;

  return text
    .replace(/(?<![`\w])(\/[a-z][a-z0-9\-\/:]*)/gi, '`$1`')
    .replace(/\b([a-z]+[A-Z][a-zA-Z0-9]*)\b/g, '`$1`')
    .replace(/\b([A-Z]{2,}\d+)\b/g, '`$1`')
    .replace(/port\s+(\d+)/gi, 'port `$1`')
    .replace(/\b(\w+\.(py|ts|tsx|js|json|env|sql))\b/g, '`$1`')
    .replace(/(localhost:\d+)/g, '`$1`')
    .replace(/\b(uuid|varchar|jsonb|decimal|timestamp|boolean)\b/g, '`$1`');
}

// Convert inline markdown (bold, code, etc.)
function processInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, `<code class="${codeStyle}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
}

// Parse and render a markdown table
function renderTable(lines: string[]): string {
  const rows = lines.filter(line => line.trim() && !line.includes('---'));
  if (rows.length === 0) return '';

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  const parseRow = (row: string) => {
    return row.split('|').filter(c => c.trim()).map(c => c.trim());
  };

  const headerCells = parseRow(headerRow);

  let html = '<div class="overflow-x-auto my-4"><table class="w-full border-collapse">';

  // Header
  html += '<thead><tr class="bg-gray-800 border-b border-gray-600">';
  headerCells.forEach(cell => {
    const processed = processInlineMarkdown(styleTechnicalTerms(cell));
    html += `<th class="px-4 py-3 text-left text-sm font-semibold text-gray-200">${processed}</th>`;
  });
  html += '</tr></thead>';

  // Body
  if (bodyRows.length > 0) {
    html += '<tbody>';
    bodyRows.forEach((row, idx) => {
      const cells = parseRow(row);
      const bgClass = idx % 2 === 0 ? 'bg-gray-800/30' : 'bg-gray-800/50';
      html += `<tr class="${bgClass} border-b border-gray-700/50 hover:bg-gray-700/30">`;
      cells.forEach(cell => {
        const processed = processInlineMarkdown(styleTechnicalTerms(cell));
        html += `<td class="px-4 py-2.5 text-sm text-gray-300">${processed}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody>';
  }

  html += '</table></div>';
  return html;
}

// Main markdown renderer
function renderMarkdown(content: string): string {
  const lines = content.split('\n');
  let html = '';
  let i = 0;
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLang = '';

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockContent = '';
      } else {
        html += `<pre class="bg-gray-900 border border-gray-700 p-4 rounded-lg overflow-x-auto my-4 text-sm"><code class="text-green-400">${codeBlockContent}</code></pre>`;
        inCodeBlock = false;
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line;
      i++;
      continue;
    }

    // Tables
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      html += renderTable(tableLines);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      html += `<h3 class="text-lg font-semibold text-white mt-8 mb-3">${processInlineMarkdown(line.slice(4))}</h3>`;
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      html += `<h2 class="text-xl font-bold text-white mt-10 mb-4 pb-2 border-b border-gray-700">${processInlineMarkdown(line.slice(3))}</h2>`;
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      html += `<h1 class="text-2xl font-bold text-white mb-6">${processInlineMarkdown(line.slice(2))}</h1>`;
      i++;
      continue;
    }

    // Lists
    if (line.match(/^- (.+)$/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^- (.+)$/)) {
        const match = lines[i].match(/^- (.+)$/);
        if (match) listItems.push(match[1]);
        i++;
      }
      html += '<ul class="my-4 space-y-2">';
      listItems.forEach(item => {
        const processed = processInlineMarkdown(styleTechnicalTerms(item));
        html += `<li class="flex items-start gap-2 text-gray-300"><span class="text-blue-400 mt-1">•</span><span>${processed}</span></li>`;
      });
      html += '</ul>';
      continue;
    }

    // Numbered lists
    if (line.match(/^\d+\. (.+)$/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. (.+)$/)) {
        const match = lines[i].match(/^\d+\. (.+)$/);
        if (match) listItems.push(match[1]);
        i++;
      }
      html += '<ol class="my-4 space-y-2">';
      listItems.forEach((item, idx) => {
        const processed = processInlineMarkdown(styleTechnicalTerms(item));
        html += `<li class="flex items-start gap-3 text-gray-300"><span class="text-blue-400 font-semibold min-w-[1.5rem]">${idx + 1}.</span><span>${processed}</span></li>`;
      });
      html += '</ol>';
      continue;
    }

    // Paragraphs
    if (line.trim()) {
      const processed = processInlineMarkdown(styleTechnicalTerms(line.trim()));
      html += `<p class="text-gray-300 my-3 leading-relaxed">${processed}</p>`;
    }

    i++;
  }

  return html;
}

export default function DocsPage() {
  const [activeCategory, setActiveCategory] = useState<string>(documentationContent[0].id);
  const [activeSection, setActiveSection] = useState<string>(documentationContent[0].sections[0].id);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([documentationContent[0].id])
  );

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const selectSection = (categoryId: string, sectionId: string) => {
    setActiveCategory(categoryId);
    setActiveSection(sectionId);
    if (!expandedCategories.has(categoryId)) {
      setExpandedCategories(new Set([...expandedCategories, categoryId]));
    }
  };

  const currentCategory = documentationContent.find(c => c.id === activeCategory);
  const currentSection = currentCategory?.sections.find(s => s.id === activeSection);

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-6">
      {/* Sidebar */}
      <nav className="w-64 bg-gray-800/50 border-r border-gray-700 overflow-y-auto flex-shrink-0">
        <div className="p-4">
          <h2 className="text-lg font-semibold text-white mb-4">Documentation</h2>
          <ul className="space-y-1">
            {documentationContent.map((category) => (
              <li key={category.id}>
                <button
                  onClick={() => toggleCategory(category.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors ${
                    activeCategory === category.id
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                  }`}
                >
                  <span>{category.icon}</span>
                  <span className="flex-1">{category.title}</span>
                  <span className="text-xs">{expandedCategories.has(category.id) ? '▼' : '▶'}</span>
                </button>
                {expandedCategories.has(category.id) && (
                  <ul className="ml-6 mt-1 space-y-1">
                    {category.sections.map((section) => (
                      <li key={section.id}>
                        <button
                          onClick={() => selectSection(category.id, section.id)}
                          className={`w-full px-3 py-1.5 text-left text-sm rounded transition-colors ${
                            activeSection === section.id && activeCategory === category.id
                              ? 'text-blue-400 bg-blue-500/10'
                              : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {section.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          {currentSection && (
            <article
              className="prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(currentSection.content) }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

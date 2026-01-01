'use client';

import { useState } from 'react';
import { documentationContent, DocCategory, DocSection } from './content';

// Style for inline code/technical terms
const codeStyle = 'bg-gray-700/50 text-blue-400 px-1.5 py-0.5 rounded text-sm font-mono';

// Auto-detect and style technical terms (applied before markdown conversion)
function styleTechnicalTerms(text: string): string {
  // Skip if already has backticks (will be handled by markdown)
  if (text.includes('`')) return text;

  return text
    // API paths: /auth/login, /positions/:id, etc.
    .replace(/(?<![`\w])(\/[a-z][a-z0-9\-\/:]*)/gi, '`$1`')
    // camelCase variables: entryPrice, stopPrice, currentPrice, etc.
    .replace(/\b([a-z]+[A-Z][a-zA-Z0-9]*)\b/g, '`$1`')
    // Technical abbreviations with numbers: SMA200, SMA50, SMA20, ADV45
    .replace(/\b([A-Z]{2,}\d+)\b/g, '`$1`')
    // Ports and specific numbers in technical context: port 667, port 4002
    .replace(/port\s+(\d+)/gi, 'port `$1`')
    // File paths and extensions: .env, proxy.py, etc.
    .replace(/\b(\w+\.(py|ts|tsx|js|json|env|sql))\b/g, '`$1`')
    // localhost with port
    .replace(/(localhost:\d+)/g, '`$1`')
    // uuid, varchar, jsonb, decimal, timestamp, enum, int, boolean, text (database types)
    .replace(/\b(uuid|varchar|jsonb|decimal|timestamp|boolean)\b/g, '`$1`');
}

// Pre-process content to add backticks around technical terms
function preprocessContent(content: string): string {
  return content
    .split('\n')
    .map(line => {
      // Skip lines that are headers, code blocks, or already processed
      if (line.startsWith('#') || line.startsWith('```') || line.startsWith('|')) {
        return line;
      }
      return styleTechnicalTerms(line);
    })
    .join('\n');
}

// Simple markdown renderer (no external library)
function renderMarkdown(content: string): string {
  // First preprocess to add backticks around technical terms
  const processed = preprocessContent(content);

  return processed
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-white mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold text-white mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-white mb-4">$1</h1>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-900 border border-gray-700 p-4 rounded-lg overflow-x-auto my-4 text-sm"><code class="text-green-400">$2</code></pre>')
    // Inline code (backticks) - must come before bold to avoid conflicts
    .replace(/`([^`]+)`/g, `<code class="${codeStyle}">$1</code>`)
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    // Tables - improved styling
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (match.includes('---')) return '';
      return `<tr class="border-b border-gray-700">${cells.map(c => {
        return `<td class="px-3 py-2 text-gray-300">${c.trim()}</td>`;
      }).join('')}</tr>`;
    })
    // Lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-gray-300">• $1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-gray-300 list-decimal">$1</li>')
    // Paragraphs (lines that aren't already HTML)
    .replace(/^(?!<)(.+)$/gm, (match) => {
      if (match.startsWith('<') || match.trim() === '') return match;
      return `<p class="text-gray-300 my-2">${match}</p>`;
    })
    // Clean up empty paragraphs
    .replace(/<p class="text-gray-300 my-2"><\/p>/g, '');
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
        <div className="max-w-3xl mx-auto p-8">
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

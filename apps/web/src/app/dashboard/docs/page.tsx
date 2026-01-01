'use client';

import { useState } from 'react';
import { documentationContent, DocCategory, DocSection } from './content';

// Simple markdown renderer (no external library)
function renderMarkdown(content: string): string {
  return content
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-white mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold text-white mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-white mb-4">$1</h1>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-800 p-4 rounded-lg overflow-x-auto my-4 text-sm"><code class="text-green-400">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1.5 py-0.5 rounded text-green-400 text-sm">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    // Tables
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      const isHeader = match.includes('---');
      if (isHeader) return '';
      return `<tr>${cells.map(c => `<td class="border border-gray-700 px-3 py-2">${c.trim()}</td>`).join('')}</tr>`;
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

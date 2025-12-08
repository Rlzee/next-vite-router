import { readViteConfig, writeViteConfig } from "./config-vite";

/**
 * Add Tailwind CSS to vite.config
 */
export function addTailwindToViteConfig(projectDir: string) {
  const content = readViteConfig(projectDir);
  if (!content) throw new Error("Vite config not found");

  if (content.includes("@tailwindcss/vite")) {
    return;
  }

  let updatedContent = content;

  const importRegex = /(import\s+.*from\s+['"].*['"];?\s*\n)+/;
  const match = updatedContent.match(importRegex);
  
  if (match) {
    const lastImportEnd = match[0].length;
    updatedContent =
      updatedContent.slice(0, lastImportEnd) +
      "import tailwindcss from '@tailwindcss/vite';\n" +
      updatedContent.slice(lastImportEnd);
  } else {
    updatedContent = "import tailwindcss from '@tailwindcss/vite';\n\n" + updatedContent;
  }

  const pluginsArrayRegex = /plugins:\s*\[([^\]]*)\]/s;
  const pluginsMatch = updatedContent.match(pluginsArrayRegex);

  if (pluginsMatch) {
    const pluginsContent = pluginsMatch[1];
    const newPluginsContent = pluginsContent.trim() 
      ? pluginsContent.trimEnd() + ",\n    tailwindcss()"
      : "\n    tailwindcss()\n  ";
    
    updatedContent = updatedContent.replace(
      pluginsArrayRegex,
      `plugins: [${newPluginsContent}\n  ]`
    );
  } else {
    const defineConfigRegex = /defineConfig\(\{/;
    updatedContent = updatedContent.replace(
      defineConfigRegex,
      "defineConfig({\n  plugins: [tailwindcss()],"
    );
  }

  writeViteConfig(projectDir, updatedContent);
}
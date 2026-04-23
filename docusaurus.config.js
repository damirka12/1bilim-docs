const {themes} = require('prism-react-renderer');
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'onebilim',
  tagline: 'Қазақстандағы №1 ағылшын курсы',
  favicon: 'img/favicon.ico',
  url: 'https://damirka12.github.io',
  baseUrl: '/',
  organizationName: 'damirka12',
  projectName: '1bilim-docs',
  onBrokenLinks: 'throw',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: { defaultLocale: 'ru', locales: ['ru'] },
  presets: [['classic', {
    docs: { sidebarPath: './sidebars.js', routeBasePath: '/' },
    blog: false,
    theme: { customCss: './src/css/custom.css' },
  }]],
  themes: ['@docusaurus/theme-mermaid'],
  themeConfig: {
    mermaid: {
      theme: { light: 'neutral', dark: 'dark' },
    },
    navbar: {
      title: 'onebilim',
      items: [{ type: 'docSidebar', sidebarId: 'mainSidebar', position: 'left', label: 'Документация' }],
    },
    prism: { theme: themes.github, darkTheme: themes.dracula },
  },
};
module.exports = config;

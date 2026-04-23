/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: '👋 Введение',
    },
    {
      type: 'category',
      label: '📋 Техническое задание',
      collapsed: false,
      items: [
        'tz/overview',
        'tz/roles',
        'tz/admin',
        'tz/curator',
        'tz/student',
        'tz/database',
        'tz/api',
        'tz/notifications',
        'tz/payments',
      ],
    },
    {
      type: 'category',
      label: '🎨 Дизайн',
      collapsed: false,
      items: [
        'design/brand-guide',
        'design/mobile',
        'design/desktop',
      ],
    },
    {
      type: 'category',
      label: '🏗️ Архитектура',
      collapsed: false,
      items: [
        'architecture/overview',
        'architecture/microservices',
        'architecture/tech-stack',
        'architecture/database',
        'architecture/erd',
        'architecture/integrations',
      ],
    },
    {
      type: 'category',
      label: '📝 ТЗ на разработку',
      collapsed: true,
      items: [
        'dev-tz/sprint-1-auth',
        'dev-tz/sprint-2-courses',
        'dev-tz/sprint-3-curator',
        'dev-tz/sprint-4-student',
        'dev-tz/sprint-5-payments',
        'dev-tz/sprint-6-speaking',
      ],
    },
  ],
};
module.exports = sidebars;

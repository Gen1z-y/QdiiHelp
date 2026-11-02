import { createApp } from 'vue';
// 设计令牌与基础样式
import './styles/base.scss';
// src/shared 输出的 HTML 片段配套样式
import './styles/panels.scss';
import App from './App.vue';

createApp(App).mount('#app');

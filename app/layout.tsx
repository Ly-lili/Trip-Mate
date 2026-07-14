import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TripMate 智能旅行助手',
  description: '基于 DeepSeek 和工具服务的单智能体旅行规划助手',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

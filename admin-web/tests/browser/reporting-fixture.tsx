import React from 'react';
import { createRoot } from 'react-dom/client';
import { Desk, StatStrip } from '@/components/Desk';
import CommandForm from '@/components/CommandForm';
import Workspace from '@/components/Workspace';
import * as Viz from '@/components/Viz';
import Link from './reporting-router';

declare global { interface Window { __REPORT_PAGE__: { tree: unknown }; __REPORT_ACTIONS__: unknown[] } }
window.__REPORT_ACTIONS__ = [];

// Actual Workspace and CSS; Shell navigation/auth transport are separate acceptance boundaries.
function Shell({ admin, title, sub, children }: { admin: { id: string; role: string }; title: string; sub: string; children: React.ReactNode }) {
  return <div data-pc-staff={admin.id + ':' + admin.role} style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>
    <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><Workspace>
      <h1>{title}</h1><p>{sub}</p>{children}
    </Workspace></main>
  </div>;
}
const components: Record<string, React.ElementType> = { Shell, Desk, StatStrip, CommandForm, Link, ...Viz };
async function invoke(action: string, data: FormData) {
  const response = await fetch('/__report_action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, fields: [...data.entries()] }) });
  const result = await response.json(); window.__REPORT_ACTIONS__.push(result);
  if (result.error) throw new Error(result.error);
  return result.value;
}
function revive(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(revive);
  const node = value as Record<string, unknown>;
  if (typeof node.__auditAction === 'string') return (data: FormData) => invoke(node.__auditAction as string, data);
  if (typeof node.type === 'string' && node.props) {
    const component = node.type === 'fragment' ? React.Fragment : node.type.startsWith('component:') ? components[node.type.slice(10)] : node.type;
    if (!component) throw new Error('Uncovered component: ' + node.type);
    return React.createElement(component, { ...Object.fromEntries(Object.entries(node.props as Record<string, unknown>).map(([k, v]) => [k, revive(v)])), key: node.key as React.Key | undefined });
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, revive(v)]));
}
createRoot(document.getElementById('root')!).render(revive(window.__REPORT_PAGE__.tree) as React.ReactNode);

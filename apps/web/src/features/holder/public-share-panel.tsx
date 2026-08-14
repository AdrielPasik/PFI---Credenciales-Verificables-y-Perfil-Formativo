'use client';

import { Copy, ExternalLink, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PublicSharePanel({
  title,
  sharePath,
  credentialReference,
  description
}: {
  title: string;
  sharePath: string;
  credentialReference?: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState(sharePath);

  function openShare() {
    setShareUrl(`${window.location.origin}${sharePath}`);
    setOpen((value) => !value);
  }

  async function copy(value: string, label: string) {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage('No pudimos copiar automáticamente. Podés copiar el enlace manualmente.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copiado.`);
    } catch {
      setCopyMessage('No pudimos copiar automáticamente. Podés copiar el enlace manualmente.');
    }
  }

  return <div className="grid gap-3"><Button type="button" variant="secondary" className="w-fit" onClick={openShare}><Share2 aria-hidden="true" />{title}</Button>{open ? <div className="grid gap-4 rounded-card border border-border-strong bg-surface-muted p-4 text-sm"><div><p className="font-semibold text-text-strong">{title}</p><p className="mt-1 leading-6 text-text-muted">{description}</p></div><ShareField label="Enlace público" value={shareUrl} onCopy={() => void copy(shareUrl, 'Enlace')} />{credentialReference ? <><ShareField label="Código de credencial" value={credentialReference} onCopy={() => void copy(credentialReference, 'Código')} /><p className="text-xs leading-5 text-text-subtle">El código identifica la credencial en Traza. No es la huella canónica.</p></> : null}<Button asChild variant="ghost" className="w-fit"><Link href={sharePath}><ExternalLink aria-hidden="true" />Ver vista pública</Link></Button>{copyMessage ? <p aria-live="polite" className="text-sm text-text-muted">{copyMessage}</p> : null}</div> : null}</div>;
}

function ShareField({ label, value, onCopy }: { label: string; value: string; onCopy(): void }) {
  return <div className="grid gap-2"><label className="text-xs font-semibold tracking-wide text-text-muted uppercase">{label}</label><div className="flex flex-col gap-2 sm:flex-row"><Input readOnly value={value} aria-label={label} /><Button type="button" variant="secondary" onClick={onCopy}><Copy aria-hidden="true" />Copiar</Button></div></div>;
}

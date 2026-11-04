import { Card, CardTitle } from '../../components/ui/card';
import { useState, useEffect } from 'react';
import { Moon, Mail, Phone, User, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDriverProfile } from '../../hooks/useDriverQuery';

export default function SettingsPage(){
  const [dark,setDark]=useState(() => document.documentElement.classList.contains('dark'));
  const { data } = useDriverProfile() as any;
  const user = data?.user;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    if (dark) localStorage.setItem('driver-dark','1'); else localStorage.removeItem('driver-dark');
  }, [dark]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Settings</h1>
      <Card>
        <CardTitle>Preferences</CardTitle>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-accent-200 p-4 dark:border-white/5">
          <div className="flex items-center gap-3"><Moon className="h-5 w-5 text-brand-600" /><span className="font-medium dark:text-white">Dark mode</span></div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)} className="peer sr-only" />
            <div className="peer h-6 w-11 rounded-full bg-accent-200 peer-checked:bg-brand-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-5" />
          </label>
        </div>
      </Card>
      <Card>
        <CardTitle>Account</CardTitle>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 rounded-2xl bg-accent-50 p-4 dark:bg-white/5"><User className="h-4 w-4 text-brand-600" /><span className="dark:text-white">{user?.name || '—'}</span></div>
          <div className="flex items-center gap-2 rounded-2xl bg-accent-50 p-4 dark:bg-white/5"><Mail className="h-4 w-4 text-brand-600" /><span className="dark:text-white">{user?.email || '—'}</span></div>
          <div className="flex items-center gap-2 rounded-2xl bg-accent-50 p-4 dark:bg-white/5"><Phone className="h-4 w-4 text-brand-600" /><span className="dark:text-white">{user?.phone || 'Not recorded'}</span></div>
        </div>
        <Link to="/profile" className="mt-4 inline-flex min-h-11 items-center rounded-full btn-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">Edit profile & password</Link>
      </Card>
      <Card>
        <CardTitle>Security</CardTitle>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-accent-50 p-4 text-sm text-muted dark:bg-white/5">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <p>Two-factor authentication is not enabled on this account. Password changes revoke other sessions and are managed from your profile.</p>
        </div>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import type { AdminUserDTO } from '@whatif/shared';
import { del, get, patch, post } from '../../api/client';
import { keys } from '../../api/queries';
import { useSession } from '../../lib/session';
import { relativeTime } from '../../lib/format';
import { Badge, Button, Callout, ConfirmDialog, Dialog, Field, Input, Select, Skeleton, useToast } from '../../components/ui';

/** A readable random password the administrator can pass on. */
function suggestPassword(): string {
  const words = ['river', 'cedar', 'atlas', 'harbor', 'olive', 'summit', 'lantern', 'meadow', 'falcon', 'amber', 'canyon', 'breeze', 'sahara', 'jasmine', 'pebble', 'orbit'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0]! % words.length]!;
  const n = 10 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 90);
  return `${pick()}-${pick()}-${pick()}-${n}`;
}

export function PeopleSettings() {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: keys.adminUsers, queryFn: ({ signal }) => get<AdminUserDTO[]>('/admin/users', signal) });
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUserDTO | null>(null);
  const [deleting, setDeleting] = useState<AdminUserDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.adminUsers });
    void qc.invalidateQueries({ queryKey: keys.admin });
  };

  const setRole = async (u: AdminUserDTO, role: 'admin' | 'member') => {
    try {
      await patch(`/admin/users/${u.id}`, { role });
      refresh();
      toast(role === 'admin' ? `${u.name} is now an administrator.` : `${u.name} is now a member.`);
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  return (
    <div className="settings-form">
      <div className="settings-group">
        <div className="row-between">
          <div>
            <h2>People</h2>
            <p>Create accounts for the people you plan with — a partner, family, friends. Then open a decision and choose <strong>Share</strong> to work on it together.</p>
          </div>
          <Button variant="primary" icon={<UserPlus aria-hidden />} onClick={() => setCreating(true)}>
            Add a person
          </Button>
        </div>
        {!q.data ? (
          <Skeleton height={160} />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="r">Decisions</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.id}>
                    <td className="lead">
                      <strong>{u.name}</strong>
                      {u.id === user?.id && <span className="muted"> (you)</span>}
                      <div className="muted small">{u.email}</div>
                      {u.locked && <Badge tone="warn">Locked after failed sign-ins</Badge>}
                    </td>
                    <td>
                      {u.id === user?.id ? (
                        <Badge tone="accent">Administrator</Badge>
                      ) : (
                        <Select aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => void setRole(u, e.target.value as 'admin' | 'member')}>
                          <option value="member">Member</option>
                          <option value="admin">Administrator</option>
                        </Select>
                      )}
                    </td>
                    <td className="r">{u.decisions}</td>
                    <td>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                    <td className="r nowrap">
                      {u.id !== user?.id && (
                        <>
                          <Button size="sm" variant="ghost" icon={<KeyRound aria-hidden />} onClick={() => setResetFor(u)}>
                            New password
                          </Button>
                          <Button size="sm" variant="ghost" iconOnly aria-label={`Delete ${u.name}`} icon={<Trash2 aria-hidden />} onClick={() => setDeleting(u)} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          <strong>Members</strong> see only their own decisions and the ones shared with them. <strong>Administrators</strong> can also manage people and instance settings — they cannot read other people’s decisions.
        </p>
      </div>

      <CreatePersonDialog open={creating} onClose={() => setCreating(false)} onCreated={refresh} />
      <ResetPasswordDialog person={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        danger
        loading={busy}
        title={`Delete ${deleting?.name ?? ''}’s account?`}
        confirmLabel="Delete account"
        description="Their own decisions, journal and reports are deleted permanently. Decisions they were only invited to stay with their owners. This cannot be undone."
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await del(`/admin/users/${deleting.id}`);
            toast(`${deleting.name}’s account was deleted.`);
            setDeleting(null);
            refresh();
          } catch (err) {
            toast((err as Error).message, 'bad');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function CreatePersonDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null);
  const close = () => {
    setName('');
    setEmail('');
    setPassword(suggestPassword());
    setRole('member');
    setError(null);
    setDone(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/admin/users', { name, email, password, role });
      setDone({ name, email: email.trim().toLowerCase(), password });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    const text = `What-If account\nAddress: ${window.location.origin}\nEmail: ${done.email}\nPassword: ${done.password}\n\nChange your password after signing in: Settings → Security.`;
    return (
      <Dialog
        open={open}
        onClose={close}
        title={`${done.name} can sign in now`}
        description="Pass these details on in person or in a private message. The password is not shown again."
        footer={
          <>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  toast('Copied.');
                } catch {
                  toast('Copy failed — select the text instead.', 'bad');
                }
              }}
            >
              Copy details
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        }
      >
        <pre className="credentials">{text}</pre>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a person"
      description="They get their own private space. Nothing of yours is visible to them until you share a decision."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!name.trim() || !email.trim() || password.length < 10}>
            Create account
          </Button>
        </>
      }
    >
      {error && <Callout tone="bad">{error}</Callout>}
      <Field label="Name" htmlFor="np-name">
        <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} />
      </Field>
      <Field label="Email" htmlFor="np-email" hint="They sign in with this address. No email is sent.">
        <Input id="np-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Temporary password" htmlFor="np-pass" hint="At least 10 characters. They can change it in Settings → Security.">
        <div className="row">
          <Input id="np-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Button variant="ghost" onClick={() => setPassword(suggestPassword())}>
            New suggestion
          </Button>
        </div>
      </Field>
      <Field label="Role" htmlFor="np-role">
        <Select id="np-role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
          <option value="member">Member — plans their own decisions</option>
          <option value="admin">Administrator — can also manage people</option>
        </Select>
      </Field>
    </Dialog>
  );
}

function ResetPasswordDialog({ person, onClose }: { person: AdminUserDTO | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={person !== null}
      onClose={onClose}
      title={`New password for ${person?.name ?? ''}`}
      description="They are signed out everywhere and can sign in with the new password straight away. A locked account is unlocked."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={password.length < 10}
            onClick={async () => {
              if (!person) return;
              setBusy(true);
              try {
                await post(`/admin/users/${person.id}/password`, { password });
                try {
                  await navigator.clipboard.writeText(password);
                  toast('Password changed and copied.');
                } catch {
                  toast('Password changed.');
                }
                setPassword(suggestPassword());
                onClose();
              } catch (err) {
                toast((err as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Set password
          </Button>
        </>
      }
    >
      <Field label="New password" htmlFor="rp-pass" hint="At least 10 characters.">
        <Input id="rp-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </Dialog>
  );
}

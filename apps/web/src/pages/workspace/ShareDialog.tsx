import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus, Users } from 'lucide-react';
import type { DecisionDTO, DecisionPeopleDTO, PersonDTO } from '@whatif/shared';
import { del, get, patch, post } from '../../api/client';
import { keys } from '../../api/queries';
import { useSession } from '../../lib/session';
import { Badge, Button, Callout, Dialog, EmptyState, Field, Select, useToast } from '../../components/ui';

const ROLE_HELP = {
  editor: 'Can change scenarios, numbers, milestones and run experiments.',
  viewer: 'Can look at everything but change nothing.',
};

/** Owner: invite people and set their role. Others: see who is involved, or leave. */
export function ShareDialog({ open, onClose, decision, onChanged }: { open: boolean; onClose: () => void; decision: DecisionDTO; onChanged: () => void }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = decision.access === 'owner';
  const everyone = useQuery({ queryKey: keys.people, queryFn: ({ signal }) => get<PersonDTO[]>('/people', signal), enabled: open && isOwner });
  const [people, setPeople] = useState<DecisionPeopleDTO>(decision.people);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = (next: DecisionPeopleDTO) => {
    setPeople(next);
    void qc.invalidateQueries({ queryKey: keys.decision(decision.id) });
    onChanged();
  };
  const available = (everyone.data ?? []).filter((p) => p.id !== people.owner.id && !people.members.some((m) => m.id === p.id));

  const add = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      changed(await post<DecisionPeopleDTO>(`/decisions/${decision.id}/people`, { userId: pick, role }));
      const who = available.find((p) => p.id === pick)?.name ?? 'They';
      setPick('');
      toast(`${who} can now open this decision.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isOwner ? 'Share this decision' : 'People on this decision'}
      description={
        isOwner
          ? 'Work on it together: everyone sees the same scenarios and results. Journals, reports and analyst chats stay private to each person.'
          : `${people.owner.name} owns this decision and shared it with you.`
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {error && <Callout tone="bad">{error}</Callout>}
      {isOwner && (
        <div className="share-add">
          {everyone.data && everyone.data.length === 0 ? (
            <EmptyState icon={<Users aria-hidden />} title="Nobody to share with yet">
              {user?.role === 'admin' ? 'Create an account for them in Settings → People, then come back here.' : 'Ask the administrator of this What-If server to create an account for them.'}
            </EmptyState>
          ) : (
            <>
              <Field label="Person" htmlFor="share-who">
                <Select id="share-who" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Choose someone…</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="They can" htmlFor="share-role" hint={ROLE_HELP[role]}>
                <Select id="share-role" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
                  <option value="editor">Edit</option>
                  <option value="viewer">View only</option>
                </Select>
              </Field>
              <Button variant="primary" loading={busy} disabled={!pick} onClick={() => void add()}>
                Share
              </Button>
            </>
          )}
        </div>
      )}

      <ul className="people-list" aria-label="People with access">
        <li>
          <span className="avatar" aria-hidden>
            {people.owner.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="who">
            <strong>{people.owner.name}</strong>
            {people.owner.id === user?.id && <span className="muted"> (you)</span>}
            <small>{people.owner.email}</small>
          </span>
          <Badge tone="accent">Owner</Badge>
        </li>
        {people.members.map((m) => (
          <li key={m.id}>
            <span className="avatar" aria-hidden>
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="who">
              <strong>{m.name}</strong>
              {m.id === user?.id && <span className="muted"> (you)</span>}
              <small>{m.email}</small>
            </span>
            {isOwner ? (
              <>
                <Select
                  aria-label={`What ${m.name} can do`}
                  value={m.role}
                  onChange={async (e) => {
                    try {
                      changed(await patch<DecisionPeopleDTO>(`/decisions/${decision.id}/people/${m.id}`, { role: e.target.value }));
                    } catch (err) {
                      toast((err as Error).message, 'bad');
                    }
                  }}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={`Remove ${m.name}`}
                  icon={<UserMinus aria-hidden />}
                  onClick={async () => {
                    try {
                      await del(`/decisions/${decision.id}/people/${m.id}`);
                      changed({ ...people, members: people.members.filter((x) => x.id !== m.id) });
                      toast(`${m.name} no longer has access.`);
                    } catch (err) {
                      toast((err as Error).message, 'bad');
                    }
                  }}
                />
              </>
            ) : (
              <Badge outline>{m.role === 'editor' ? 'Can edit' : 'Can view'}</Badge>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

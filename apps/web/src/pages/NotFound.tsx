import { Compass } from 'lucide-react';
import { ButtonLink, EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState icon={<Compass />} title="This page doesn’t exist" actions={<ButtonLink to="/" variant="primary">Back to overview</ButtonLink>}>
        The link may be outdated, or the item was deleted.
      </EmptyState>
    </div>
  );
}

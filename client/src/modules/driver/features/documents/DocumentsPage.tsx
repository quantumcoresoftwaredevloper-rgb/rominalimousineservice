import { Card, CardTitle } from '../../components/ui/card';
import { FileText, AlertCircle } from 'lucide-react';

export default function DocumentsPage(){
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Documents</h1>
      <Card>
        <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> Document management is not configured</CardTitle>
        <p className="mt-2 text-sm text-muted">
          This platform does not store driver licences, registrations, insurance certificates or
          permits, and it does not verify expiry dates. Do not upload identity documents here.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Send compliance documents directly to dispatch. An admin can then record your approval status.</p>
        </div>
      </Card>
    </div>
  );
}

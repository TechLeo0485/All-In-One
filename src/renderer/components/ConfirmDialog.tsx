import { useAppStore } from '../stores/appStore'
import { Button, Modal } from './ui'

/** Renders the pending askConfirm() request, if any. Mounted once in App. */
export function ConfirmDialog() {
  const request = useAppStore((s) => s.confirmRequest)
  const resolveConfirm = useAppStore((s) => s.resolveConfirm)
  if (!request) return null

  return (
    <Modal
      title={request.title}
      width="max-w-sm"
      onClose={() => resolveConfirm(false)}
      footer={
        <>
          <Button onClick={() => resolveConfirm(false)}>Cancel</Button>
          <Button
            autoFocus
            variant={request.danger ? 'danger' : 'primary'}
            onClick={() => resolveConfirm(true)}
          >
            {request.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">{request.message}</p>
    </Modal>
  )
}

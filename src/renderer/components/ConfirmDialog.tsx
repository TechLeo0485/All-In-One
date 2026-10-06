import { useState } from 'react'
import { useAppStore, type ChoiceRequest } from '../stores/appStore'
import { Button, Modal } from './ui'

/** Renders the pending askConfirm() / askChoice() request, if any. Mounted once in App. */
export function ConfirmDialog() {
  const request = useAppStore((s) => s.confirmRequest)
  const resolveConfirm = useAppStore((s) => s.resolveConfirm)
  const choice = useAppStore((s) => s.choiceRequest)

  return (
    <>
      {choice && <ChoiceDialog key={choice.title + choice.choices.length} request={choice} />}
      {request && (
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
      )}
    </>
  )
}

function ChoiceDialog({ request }: { request: ChoiceRequest }) {
  const resolveChoice = useAppStore((s) => s.resolveChoice)
  const [value, setValue] = useState(request.choices[0]?.value ?? '')

  return (
    <Modal
      title={request.title}
      width="max-w-sm"
      onClose={() => resolveChoice(null)}
      footer={
        <>
          <Button onClick={() => resolveChoice(null)}>Cancel</Button>
          <Button autoFocus variant={request.danger ? 'danger' : 'primary'} onClick={() => resolveChoice(value)}>
            {request.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {request.choices.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-200">
            <input type="radio" name="choice" checked={value === c.value} onChange={() => setValue(c.value)} />
            {c.label}
          </label>
        ))}
      </div>
    </Modal>
  )
}

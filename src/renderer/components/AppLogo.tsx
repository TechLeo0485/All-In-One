import appIcon from '../../../resources/icon.png'
import { APP_NAME } from '@shared/brand'

/** The product icon (same image as the window, tray and notification icon). */
export function AppLogo({ size = 32 }: { size?: number }) {
  return <img src={appIcon} width={size} height={size} alt={APP_NAME} draggable={false} className="shrink-0" />
}

import fs from 'fs';
import { shell } from 'electron';

// 利用者のデータ (作り直せないもの) を消すときは、ごみ箱に移す (戻せるようにする)。
// ごみ箱に移せない場合 (ごみ箱の無いドライブなど) は完全に削除する
export async function moveToTrash(target: string): Promise<void> {
    try {
        await shell.trashItem(target);
    } catch (error) {
        console.warn(`failed to move ${target} to the trash; deleting it`, error);
        await fs.promises.rm(target, { recursive: true, force: true });
    }
}

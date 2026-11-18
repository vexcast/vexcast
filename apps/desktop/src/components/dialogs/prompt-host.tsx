import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";

export function ConfirmHost() {
  const t = useT();
  const req = useDialogs((d) => d.confirm);
  const done = (ok: boolean) => {
    req?.resolve(ok);
    useDialogs.setState({ confirm: null });
  };
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => !o && done(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction className={req?.destructive ? buttonVariants({ variant: "destructive" }) : undefined} onClick={() => done(true)} data-testid="confirm-ok">
            {req?.confirmLabel ?? t.common.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PromptHost() {
  const t = useT();
  const req = useDialogs((d) => d.prompt);
  const [value, setValue] = useState("");
  useEffect(() => setValue(req?.defaultValue ?? ""), [req]);
  const done = (v: string | null) => {
    req?.resolve(v);
    useDialogs.setState({ prompt: null });
  };
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && done(null)}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            done(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>{req?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {req?.label && <Label htmlFor="prompt-input">{req.label}</Label>}
            <Input id="prompt-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} data-testid="prompt-input" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => done(null)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!value.trim()} data-testid="prompt-ok">
              {t.ok}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

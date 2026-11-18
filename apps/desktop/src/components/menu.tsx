/**
 * Menus described as data, rendered with any of the shadcn menu families
 * (ContextMenu, DropdownMenu, Menubar) so the same source menu can be used in
 * the Sources dock, the preview and the Edit menu.
 */
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import * as CM from "@/components/ui/context-menu";
import * as DM from "@/components/ui/dropdown-menu";
import * as MB from "@/components/ui/menubar";

export type MenuNode =
  | {
      type: "item";
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      disabled?: boolean;
      shortcut?: string;
      destructive?: boolean;
    }
  | { type: "check"; label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; shortcut?: string }
  | { type: "radio"; value: string; options: { value: string; label: string }[]; onValueChange: (v: string) => void }
  | { type: "sub"; label: string; icon?: LucideIcon; children: MenuNode[]; disabled?: boolean }
  | { type: "label"; label: string }
  | { type: "sep" };

export const sep: MenuNode = { type: "sep" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = ComponentType<any>;
interface Family {
  Item: C;
  CheckboxItem: C;
  RadioGroup: C;
  RadioItem: C;
  Sub: C;
  SubTrigger: C;
  SubContent: C;
  Separator: C;
  Label: C;
  Shortcut: C;
}

const families: Record<"context" | "dropdown" | "menubar", Family> = {
  context: {
    Item: CM.ContextMenuItem,
    CheckboxItem: CM.ContextMenuCheckboxItem,
    RadioGroup: CM.ContextMenuRadioGroup,
    RadioItem: CM.ContextMenuRadioItem,
    Sub: CM.ContextMenuSub,
    SubTrigger: CM.ContextMenuSubTrigger,
    SubContent: CM.ContextMenuSubContent,
    Separator: CM.ContextMenuSeparator,
    Label: CM.ContextMenuLabel,
    Shortcut: CM.ContextMenuShortcut,
  },
  dropdown: {
    Item: DM.DropdownMenuItem,
    CheckboxItem: DM.DropdownMenuCheckboxItem,
    RadioGroup: DM.DropdownMenuRadioGroup,
    RadioItem: DM.DropdownMenuRadioItem,
    Sub: DM.DropdownMenuSub,
    SubTrigger: DM.DropdownMenuSubTrigger,
    SubContent: DM.DropdownMenuSubContent,
    Separator: DM.DropdownMenuSeparator,
    Label: DM.DropdownMenuLabel,
    Shortcut: DM.DropdownMenuShortcut,
  },
  menubar: {
    Item: MB.MenubarItem,
    CheckboxItem: MB.MenubarCheckboxItem,
    RadioGroup: MB.MenubarRadioGroup,
    RadioItem: MB.MenubarRadioItem,
    Sub: MB.MenubarSub,
    SubTrigger: MB.MenubarSubTrigger,
    SubContent: MB.MenubarSubContent,
    Separator: MB.MenubarSeparator,
    Label: MB.MenubarLabel,
    Shortcut: MB.MenubarShortcut,
  },
};

export function MenuItems({ nodes, kind }: { nodes: MenuNode[]; kind: "context" | "dropdown" | "menubar" }): ReactNode {
  const F = families[kind];
  // Collapse duplicate / leading / trailing separators.
  const clean: MenuNode[] = [];
  for (const n of nodes) {
    if (n.type === "sep" && (clean.length === 0 || clean[clean.length - 1].type === "sep")) continue;
    clean.push(n);
  }
  while (clean.length && clean[clean.length - 1].type === "sep") clean.pop();
  return clean.map((n, i) => {
    switch (n.type) {
      case "sep":
        return <F.Separator key={i} />;
      case "label":
        return <F.Label key={i}>{n.label}</F.Label>;
      case "item": {
        const Icon = n.icon;
        return (
          <F.Item key={i} disabled={n.disabled} variant={n.destructive ? "destructive" : undefined} onSelect={n.onSelect}>
            {Icon && <Icon />}
            {n.label}
            {n.shortcut && <F.Shortcut>{n.shortcut}</F.Shortcut>}
          </F.Item>
        );
      }
      case "check":
        return (
          <F.CheckboxItem key={i} checked={n.checked} disabled={n.disabled} onCheckedChange={(v: boolean) => n.onCheckedChange(!!v)}>
            {n.label}
            {n.shortcut && <F.Shortcut>{n.shortcut}</F.Shortcut>}
          </F.CheckboxItem>
        );
      case "radio":
        return (
          <F.RadioGroup key={i} value={n.value} onValueChange={n.onValueChange}>
            {n.options.map((o) => (
              <F.RadioItem key={o.value} value={o.value}>
                {o.label}
              </F.RadioItem>
            ))}
          </F.RadioGroup>
        );
      case "sub": {
        const Icon = n.icon;
        return (
          <F.Sub key={i}>
            <F.SubTrigger disabled={n.disabled}>
              {Icon && <Icon />}
              {n.label}
            </F.SubTrigger>
            <F.SubContent className="min-w-48">
              <MenuItems nodes={n.children} kind={kind} />
            </F.SubContent>
          </F.Sub>
        );
      }
    }
  });
}

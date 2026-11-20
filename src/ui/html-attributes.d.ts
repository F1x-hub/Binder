// Атрибуты HTML, которых ещё нет в @types/react 19.3. React передаёт их в DOM как есть.
import 'react';

declare module 'react' {
  interface ButtonHTMLAttributes<T> {
    /** Кнопка-вызыватель (invoker commands, Chrome 135+): id элемента, которым она управляет */
    commandfor?: string;
    /** Что сделать с элементом из commandfor: toggle-popover, show-modal и т. п. */
    command?: string;
  }

  interface HTMLAttributes<T> {
    /** Стрелки между элементами группы (Chrome 150+). В Chrome 135–149 атрибут ничего не делает, стрелки ведёт свой код */
    focusgroup?: string;
  }
}

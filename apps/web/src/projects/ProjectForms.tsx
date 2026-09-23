import { useId, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Form } from '../components/ui/Form';
import { FormField } from '../components/ui/FormField';
import { useModalDialog } from '../components/use-modal-dialog';
import type { Project } from './project-api';

export function ProjectForm({
  project,
  pending,
  onSave,
}: {
  project?: Project;
  pending: boolean;
  onSave: (input: { name: string; description: string }) => Promise<boolean>;
}) {
  const descriptionId = useId();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  return (
    <Form
      className="project-form"
      onSubmit={() => {
        void onSave({ name: name.trim(), description: description.trim() }).then((ok) => {
          if (ok && !project) {
            setName('');
            setDescription('');
          }
        });
      }}
    >
      <FormField
        label="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={100}
        disabled={pending}
      />
      <div className="form-field">
        <label htmlFor={descriptionId}>Project description</label>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          disabled={pending}
        />
      </div>
      <Button type="submit" loading={pending}>
        {project ? 'Save project' : 'Create project'}
      </Button>
    </Form>
  );
}
export function CreateTaskForm({
  subtask = false,
  pending,
  onCreate,
}: {
  subtask?: boolean;
  pending: boolean;
  onCreate: (title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  return (
    <Form
      className="project-form project-form--inline"
      onSubmit={() => {
        void onCreate(title.trim()).then((ok) => {
          if (ok) setTitle('');
        });
      }}
    >
      <FormField
        label={subtask ? 'Subtask title' : 'Task title'}
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        disabled={pending}
      />
      <Button type="submit" loading={pending}>
        {subtask ? 'Add subtask' : 'Create task'}
      </Button>
    </Form>
  );
}
export function ConfirmDelete({
  label,
  description = 'This permanently deletes it and all its tasks or subtasks.',
  pending,
  onConfirm,
  onClose,
}: {
  label: string;
  description?: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useModalDialog(true);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog"
      aria-label={`Delete ${label}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <h2>Delete {label}?</h2>
      <p>{description}</p>
      <Button variant="secondary" disabled={pending} onClick={onClose}>
        Cancel
      </Button>
      <Button loading={pending} onClick={onConfirm}>
        Confirm delete
      </Button>
    </dialog>
  );
}

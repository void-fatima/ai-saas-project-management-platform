import { useId, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Form } from '../components/ui/Form';
import { FormField } from '../components/ui/FormField';
import {
  parseStatus,
  statuses,
  statusLabels,
  type Assignee,
  type Permissions,
  type Task,
} from './project-api';

export function TaskEditor({
  task,
  permissions,
  userId,
  members,
  pending,
  onSave,
}: {
  task: Task;
  permissions: Permissions;
  userId: string;
  members: Assignee[];
  pending: boolean;
  onSave: (data: {
    title: string;
    description: string;
    status: string;
    assigneeId?: string | null;
    version: number;
  }) => void;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState(task.status);
  const [assignee, setAssignee] = useState(task.assigneeId ?? '');
  const canAssign =
    permissions.assignOthers || task.assigneeId === null || task.assigneeId === userId;
  const options = permissions.assignOthers
    ? members
    : members.filter((member) => member.userId === userId);
  return (
    <Form
      className="project-form"
      onSubmit={() =>
        onSave({
          title: title.trim(),
          description: description.trim(),
          status,
          version: task.version,
          ...(canAssign ? { assigneeId: assignee || null } : {}),
        })
      }
    >
      <FormField
        label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        required
        disabled={pending}
      />
      <div className="form-field">
        <label htmlFor={`${fieldId}-description`}>Description</label>
        <textarea
          id={`${fieldId}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={10000}
          disabled={pending}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${fieldId}-status`}>Status</label>
        <select
          id={`${fieldId}-status`}
          value={status}
          onChange={(event) => setStatus(parseStatus(event.target.value))}
          disabled={pending}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {statusLabels[value]}
            </option>
          ))}
        </select>
      </div>
      {canAssign ? (
        <div className="form-field">
          <label htmlFor={`${fieldId}-assignee`}>Assignee</label>
          <select
            id={`${fieldId}-assignee`}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            disabled={pending}
          >
            <option value="">Unassigned</option>
            {task.assigneeId && !options.some((member) => member.userId === task.assigneeId) ? (
              <option value={task.assigneeId}>{task.assigneeName ?? 'Current assignee'}</option>
            ) : null}
            {!permissions.assignOthers && !options.some((member) => member.userId === userId) ? (
              <option value={userId}>Assign to me</option>
            ) : null}
            {options.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name} ({member.email})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p>
          Assigned to {task.assigneeName}. Only a Manager, Admin or Owner can change this
          assignment.
        </p>
      )}
      <Button type="submit" loading={pending}>
        Save task
      </Button>
    </Form>
  );
}

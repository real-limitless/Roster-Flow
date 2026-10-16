import { FormEvent, useEffect, useRef, useState } from "react";
import {
  fileTestId,
  skills as skillCatalog,
  workspaceFiles,
  type MsgAttachment,
  type MsgFile,
  type MsgSkill,
} from "../../data";
import { PickerMenu, type PickerItem } from "./PickerMenu";
import { useSpeechToText } from "./useSpeechToText";

export type ComposePayload = {
  text: string;
  attachments: MsgAttachment[];
  skills: MsgSkill[];
  files: MsgFile[];
};

type DraftAttachment = MsgAttachment & { preview?: string };

export function Composer({
  channelName,
  onSend,
  sendError,
  mentions = [],
  seedText = "",
  seedNonce = 0,
}: {
  channelName: string;
  onSend: (payload: ComposePayload) => void;
  sendError?: string;
  mentions?: PickerItem[];
  seedText?: string;
  seedNonce?: number;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [skills, setSkills] = useState<MsgSkill[]>([]);
  const [files, setFiles] = useState<MsgFile[]>([]);
  const [picker, setPicker] = useState<"skill" | "file" | "mention" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = useRef({ text, attachments, skills, files });
  draft.current = { text, attachments, skills, files };

  useEffect(() => {
    if (!seedNonce) return;
    setText(seedText);
  }, [seedNonce, seedText]);

  const speech = useSpeechToText((chunk) => {
    setText((prev) => (prev && !prev.endsWith(" ") ? `${prev} ${chunk}` : `${prev}${chunk}`));
  });

  const canSend = Boolean(text.trim() || attachments.length || skills.length || files.length);

  function reset() {
    draft.current.attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    setText("");
    setAttachments([]);
    setSkills([]);
    setFiles([]);
    setPicker(null);
    speech.stop();
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const next = draft.current;
    const payload: ComposePayload = {
      text: next.text.trim(),
      attachments: next.attachments.map(({ preview: _p, ...a }) => a),
      skills: next.skills,
      files: next.files,
    };
    if (!payload.text && !payload.attachments.length && !payload.skills.length && !payload.files.length) return;
    onSend(payload);
    reset();
  }

  function addFiles(list: FileList | File[]) {
    const next = Array.from(list).map((file) => ({
      id: `att-${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      return [...prev, ...next.filter((a) => !seen.has(a.id))];
    });
  }

  return (
    <form
      className={`compose ${dragOver ? "drop" : ""}`}
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
      }}
    >
      {(skills.length > 0 || files.length > 0 || attachments.length > 0) && (
        <div className="compose-chips">
          {skills.map((s) => (
            <span className="chip ok" key={s.id} data-testid={`compose-chip-skill-${s.id}`}>
              skill:{s.name}
              <button type="button" aria-label={`Remove skill ${s.name}`} onClick={() => setSkills((p) => p.filter((x) => x.id !== s.id))}>
                ×
              </button>
            </span>
          ))}
          {files.map((f) => (
            <span className="chip" key={f.path} data-testid={`compose-chip-file-${fileTestId(f.path)}`}>
              {f.path}
              <button type="button" aria-label={`Remove file ${f.path}`} onClick={() => setFiles((p) => p.filter((x) => x.path !== f.path))}>
                ×
              </button>
            </span>
          ))}
          {attachments.map((a) => (
            <span className="chip att" key={a.id}>
              {a.preview && <img src={a.preview} alt="" />}
              {a.name}
              <button
                type="button"
                aria-label={`Remove attachment ${a.name}`}
                onClick={() => {
                  if (a.preview) URL.revokeObjectURL(a.preview);
                  setAttachments((p) => p.filter((x) => x.id !== a.id));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        data-testid="composer"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Message ${channelName}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="compose-bar">
        <div className="compose-tools">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            data-testid="composer-attach-input"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="pill-btn"
            data-testid="composer-attach"
            title="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          <button
            type="button"
            className={`pill-btn ${picker === "mention" ? "on" : ""}`}
            data-testid="composer-mention"
            title="Mention a seat, team, or @channel"
            onClick={() => setPicker((p) => (p === "mention" ? null : "mention"))}
          >
            @
          </button>
          <button
            type="button"
            className={`pill-btn ${picker === "skill" ? "on" : ""}`}
            data-testid="composer-skill"
            title="Select skill"
            onClick={() => setPicker((p) => (p === "skill" ? null : "skill"))}
          >
            Skill
          </button>
          <button
            type="button"
            className={`pill-btn ${picker === "file" ? "on" : ""}`}
            data-testid="composer-file"
            title="Select workspace file"
            onClick={() => setPicker((p) => (p === "file" ? null : "file"))}
          >
            File
          </button>
          <button
            type="button"
            className={`pill-btn ${speech.listening ? "on" : ""}`}
            data-testid="composer-mic"
            title={speech.supported ? (speech.listening ? "Stop dictation" : "Speech to text") : "Speech to text is not supported in this browser"}
            disabled={!speech.supported}
            aria-pressed={speech.listening}
            onClick={() => speech.toggle()}
          >
            {speech.listening ? "Listening" : "Mic"}
          </button>
        </div>
        <button className="pill-btn primary" data-testid="send-message" type="submit" disabled={!canSend}>
          Send
        </button>
      </div>
      {sendError && (
        <p className="compose-error" data-testid="composer-error">
          {sendError}
        </p>
      )}
      {picker === "mention" && (
        <PickerMenu
          label="Mentions"
          items={mentions}
          onClose={() => setPicker(null)}
          onSelect={(it) => {
            const token = it.title.startsWith("@") ? it.title : `@${it.title}`;
            setText((prev) => (prev && !prev.endsWith(" ") ? `${prev} ${token} ` : `${prev}${token} `));
            setPicker(null);
          }}
        />
      )}
      {picker === "skill" && (
        <PickerMenu
          label="Skills"
          items={skillCatalog.map((s) => ({ id: s.id, title: s.name, subtitle: s.description, testId: `picker-item-${s.id}` }))}
          onClose={() => setPicker(null)}
          onSelect={(it) => {
            setSkills((prev) => (prev.some((s) => s.id === it.id) ? prev : [...prev, { id: it.id, name: it.title }]));
            setPicker(null);
          }}
        />
      )}
      {picker === "file" && (
        <PickerMenu
          label="Files"
          items={workspaceFiles.map((f) => ({
            id: f.path,
            title: f.path,
            subtitle: f.name,
            testId: `picker-item-${fileTestId(f.path)}`,
          }))}
          onClose={() => setPicker(null)}
          onSelect={(it) => {
            setFiles((prev) => (prev.some((f) => f.path === it.id) ? prev : [...prev, { path: it.id, name: it.subtitle || it.title }]));
            setPicker(null);
          }}
        />
      )}
    </form>
  );
}

export function ComposerPreview({ channelName = "#ship" }: { channelName?: string }) {
  return (
    <div className="compose preview" aria-hidden="true">
      <div className="compose-chips">
        <span className="chip ok">skill:brief</span>
        <span className="chip">billing/webhook.test.ts</span>
      </div>
      <div className="compose-static">Message {channelName}</div>
      <div className="compose-bar">
        <div className="compose-tools">
          <span className="pill-btn">+</span>
          <span className="pill-btn">Skill</span>
          <span className="pill-btn">File</span>
          <span className="pill-btn">Mic</span>
        </div>
        <span className="pill-btn primary">Send</span>
      </div>
    </div>
  );
}

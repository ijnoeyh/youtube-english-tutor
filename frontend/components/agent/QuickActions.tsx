// 채팅 입력 위에 표시되는 자주 쓰는 명령 버튼 모음

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

const QUICK_ACTIONS = [
  { label: "오늘 뭐 공부할까?", message: "오늘 뭐 공부하면 좋을까?" },
  { label: "복습할 거 있어?", message: "복습할 항목 추천해줘" },
  { label: "학습 현황", message: "내 학습 기록 보여줘" },
  { label: "표현 북마크", message: "북마크한 표현 보여줘" },
];

export default function QuickActions({ onSend, disabled }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => onSend(action.message)}
          disabled={disabled}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

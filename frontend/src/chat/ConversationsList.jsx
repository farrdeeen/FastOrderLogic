const sampleChats = [
  { id: 1, name: "Chauhan", lastMsg: "Sir ye kya problem...", time: "now" },
  { id: 2, name: "Sk Arshed Ali", lastMsg: "Pls connect", time: "7 min" },
  {
    id: 3,
    name: "Parmeshwar Singh",
    lastMsg: "Sir I am parmes...",
    time: "21 min",
  },
];

export default function ConversationsList({ onSelectChat }) {
  return (
    <div className="p-4">
      <h2 className="font-semibold mb-4">All Conversations</h2>

      {sampleChats.map((chat) => (
        <div
          key={chat.id}
          onClick={() => onSelectChat(chat)}
          className="flex items-center gap-3 p-2 mb-2 rounded cursor-pointer hover:bg-gray-100"
        >
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-semibold">
            {chat.name[0]}
          </div>

          <div className="flex-1">
            <div className="font-medium">{chat.name}</div>
            <div className="text-sm text-gray-500">{chat.lastMsg}</div>
          </div>

          <div className="text-xs text-gray-400">{chat.time}</div>
        </div>
      ))}
    </div>
  );
}

interface Props {
  title: string
}

export default function PlaceholderCard({ title }: Props) {
  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        border: '0.5px solid #e0ddd8',
        borderRadius: 12,
        padding: '2rem',
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: '#231F20',
        }}
      >
        {title}
      </h1>
    </div>
  )
}

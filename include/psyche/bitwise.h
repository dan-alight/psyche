#ifndef PSYCHE_BITWISE_H_
#define PSYCHE_BITWISE_H_

#include <concepts>
#include <type_traits>

namespace psyche {
// Tag to enable bitwise operations for specific enum classes
template <typename E>
struct EnableBitwiseOperators {
  static constexpr bool value = false;
};

// Helper concept for bitwise-enabled enums
template <typename E>
concept BitwiseEnum = std::is_enum_v<E> && EnableBitwiseOperators<E>::value;

// Enum-to-enum operations
template <typename E>
constexpr auto operator&(E a, E b)
  requires BitwiseEnum<E>
{
  using U = std::underlying_type_t<E>;
  return static_cast<U>(a) & static_cast<U>(b);
}

template <typename E>
constexpr auto operator|(E a, E b)
  requires BitwiseEnum<E>
{
  using U = std::underlying_type_t<E>;
  return static_cast<U>(a) | static_cast<U>(b);
}

template <typename E>
constexpr auto operator^(E a, E b)
  requires BitwiseEnum<E>
{
  using U = std::underlying_type_t<E>;
  return static_cast<U>(a) ^ static_cast<U>(b);
}

// Bitwise NOT returns the underlying type, not the enum
template <typename E>
constexpr auto operator~(E a)
  requires BitwiseEnum<E>
{
  using U = std::underlying_type_t<E>;
  return ~static_cast<U>(a);
}

// Mixed operations between enum and its underlying type
template <typename E>
constexpr auto operator&(E a, std::underlying_type_t<E> b)
  requires BitwiseEnum<E>
{
  return static_cast<std::underlying_type_t<E>>(a) & b;
}

template <typename E>
constexpr auto operator&(std::underlying_type_t<E> a, E b)
  requires BitwiseEnum<E>
{
  return a & static_cast<std::underlying_type_t<E>>(b);
}

template <typename E>
constexpr auto operator|(E a, std::underlying_type_t<E> b)
  requires BitwiseEnum<E>
{
  return static_cast<std::underlying_type_t<E>>(a) | b;
}

template <typename E>
constexpr auto operator|(std::underlying_type_t<E> a, E b)
  requires BitwiseEnum<E>
{
  return a | static_cast<std::underlying_type_t<E>>(b);
}

template <typename E>
constexpr auto operator^(E a, std::underlying_type_t<E> b)
  requires BitwiseEnum<E>
{
  return static_cast<std::underlying_type_t<E>>(a) ^ b;
}

template <typename E>
constexpr auto operator^(std::underlying_type_t<E> a, E b)
  requires BitwiseEnum<E>
{
  return a ^ static_cast<std::underlying_type_t<E>>(b);
}

// Compound assignment operators for completeness
template <typename E>
constexpr E& operator&=(E& a, E b)
  requires BitwiseEnum<E>
{
  return a = static_cast<E>(static_cast<std::underlying_type_t<E>>(a) & static_cast<std::underlying_type_t<E>>(b));
}

template <typename E>
constexpr E& operator|=(E& a, E b)
  requires BitwiseEnum<E>
{
  return a = static_cast<E>(static_cast<std::underlying_type_t<E>>(a) | static_cast<std::underlying_type_t<E>>(b));
}

template <typename E>
constexpr E& operator^=(E& a, E b)
  requires BitwiseEnum<E>
{
  return a = static_cast<E>(static_cast<std::underlying_type_t<E>>(a) ^ static_cast<std::underlying_type_t<E>>(b));
}

}  // namespace psyche

#endif
/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 8 февр. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IO_PATH_H_
#define LSP_PLUG_IN_IO_PATH_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/lltl/types.h>
#include <stdarg.h>

namespace lsp
{
    namespace io
    {
        typedef struct fattr_t
        {
            enum ftype_t {
                FT_BLOCK,
                FT_CHARACTER,
                FT_DIRECTORY,
                FT_FIFO,
                FT_SYMLINK,
                FT_REGULAR,
                FT_SOCKET,
                FT_UNKNOWN
            };

            ftype_t     type;       // File type
            size_t      blk_size;   // Block size
            wsize_t     size;       // File size
            wsize_t     inode;      // Index node
            wsize_t     ctime;      // Creation time in milliseconds
            wsize_t     mtime;      // Modification time in milliseconds
            wsize_t     atime;      // Access time in milliseconds
        } fattr_t;

        /**
         * Path object. All char * pointers are treated as UTF-8 strings unless the
         * special case is described.
         */
        class Path
        {
            private:
                LSPString   sPath;

            private:
                inline void     fixup_path();
                status_t        compute_relative(Path *base);

            public:
                explicit Path();
                Path(const Path &) = delete;
                Path(Path &&) = delete;
                ~Path();
                
                Path & operator = (const Path &) = delete;
                Path & operator = (Path &&) = delete;

                Path           *clone() const;

            public:
                // Setting and getting the path value
                /**
                 * Set the native-encoded string path to the Path object
                 * @param path path to set
                 * @param charset character set to use
                 * @return status of operation
                 */
                status_t        set_native(const char *path, const char *charset = NULL);

                /**
                 * Assign string path to the Path object
                 * @param path path to set
                 * @return status of operation
                 */
                status_t        set(const char *path);
                status_t        set(const LSPString *path);
                status_t        set(const Path *path);

                /**
                 * Construct path of two parts
                 * @param path path to set
                 * @param child the child element to append to the path
                 * @return status of operation
                 */
                status_t        set(const char *path, const char *child);
                status_t        set(const char *path, const LSPString *child);
                status_t        set(const char *path, const Path *child);

                status_t        set(const LSPString *path, const char *child);
                status_t        set(const LSPString *path, const LSPString *child);
                status_t        set(const LSPString *path, const Path *child);

                status_t        set(const Path *path, const char *child);
                status_t        set(const Path *path, const LSPString *child);
                status_t        set(const Path *path, const Path *child);

                /**
                 * Get the current path value
                 * @return current path value
                 */
                inline const char *get() const                          { return sPath.get_utf8();  }

                /**
                 * Store the path value in the provided character buffer
                 * @param path target buffer to store value
                 * @param maxlen maximum length of character buffer
                 * @return status of operation
                 */
                status_t        get(char *path, size_t maxlen) const;
                /**
                 * Store the path value in the string
                 * @param path target string object to store value
                 * @return status of operation
                 */
                status_t        get(LSPString *path) const;
                /**
                 * Store the path value in the string
                 * @param path target Path object to store value
                 * @return status of operation
                 */
                status_t        get(Path *path) const;

            public:
                // Operations with last element in the path
                /**
                 * Replace last element of the path with the new value
                 * @param path new value to use as the end of the path
                 * @return status of operation
                 */
                status_t        set_last(const char *path);
                /**
                 * Replace last element of the path with the new value
                 * @param path new value to use as the end of the path
                 * @return status of operation
                 */
                status_t        set_last(const LSPString *path);
                /**
                 * Replace last element of the path with the new value
                 * @param path new value to use as the end of the path
                 * @return status of operation
                 */
                status_t        set_last(const Path *path);

                /**
                 * Get last element of the path
                 * @param path character buffer to store character data
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        get_last(char *path, size_t maxlen) const;
                /**
                 * Get last element of the path
                 * @param path string object to store the value
                 * @return status of operation
                 */
                status_t        get_last(LSPString *path) const;
                /**
                 * Get last element of the path
                 * @param path Path object to store the value
                 * @return status of operation
                 */
                status_t        get_last(Path *path) const;

                /**
                 * Remove last element from the path object
                 * @return status of operation
                 */
                status_t        remove_last();
                /**
                 * Remove last element from the path object and return the removed element
                 * @param path character buffer to store the value
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        remove_last(char *path, size_t maxlen);
                /**
                 * Remove last element from the path object and return the removed element
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        remove_last(LSPString *path);
                /**
                 * Remove last element from the path object and return the removed element
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        remove_last(Path *path);

                /**
                 * Remove the last element from the path object and return the result value
                 * @param path character buffer to store the value
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        without_last(char *path, size_t maxlen) const;
                /**
                 * Remove the last element from the path object and return the result value
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        without_last(LSPString *path) const;
                /**
                 * Remove the last element from the path object and return the result value
                 * @param path path object to store the value
                 * @return status of operation
                 */
                status_t        without_last(Path *path) const;

            public:
                // Operations with first element in the path
                /**
                 * Get first element of the path
                 * @param path character buffer to store character data
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        get_first(char *path, size_t maxlen) const;
                /**
                 * Get first element of the path
                 * @param path string object to store the value
                 * @return status of operation
                 */
                status_t        get_first(LSPString *path) const;
                /**
                 * Get first element of the path
                 * @param path Path object to store the value
                 * @return status of operation
                 */
                status_t        get_first(Path *path) const;

                /**
                 * Remove first element from the path object
                 * @return status of operation
                 */
                status_t        remove_first();
                /**
                 * Remove first element from the path object and return the removed element
                 * @param path character buffer to store the value
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        remove_first(char *path, size_t maxlen);
                /**
                 * Remove first element from the path object and return the removed element
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        remove_first(LSPString *path);
                /**
                 * Remove first element from the path object and return the removed element
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        remove_first(Path *path);

                /**
                 * Remove the first element from the path object and return the result value
                 * @param path character buffer to store the value
                 * @param maxlen maximum length of the buffer
                 * @return status of operation
                 */
                status_t        without_first(char *path, size_t maxlen) const;
                /**
                 * Remove the first element from the path object and return the result value
                 * @param path string to store the value
                 * @return status of operation
                 */
                status_t        without_first(LSPString *path) const;
                /**
                 * Remove the first element from the path object and return the result value
                 * @param path path object to store the value
                 * @return status of operation
                 */
                status_t        without_first(Path *path) const;

            public:
                status_t        get_ext(char *path, size_t maxlen) const;
                status_t        get_ext(LSPString *path) const;
                status_t        get_ext(Path *path) const;

                status_t        get_noext(char *path, size_t maxlen) const;
                status_t        get_noext(LSPString *path) const;
                status_t        get_noext(Path *path) const;

                status_t        get_last_noext(char *path, size_t maxlen) const;
                status_t        get_last_noext(LSPString *path) const;
                status_t        get_last_noext(Path *path) const;

                status_t        get_parent(char *path, size_t maxlen) const;
                status_t        get_parent(LSPString *path) const;
                status_t        get_parent(Path *path) const;

                status_t        set_parent(const char *path);
                status_t        set_parent(const LSPString *path);
                status_t        set_parent(const Path *path);

                status_t        concat(const char *path);
                status_t        concat(const LSPString *path);
                status_t        concat(const Path *path);

                status_t        append_child(const char *path);
                status_t        append_child(const LSPString *path);
                status_t        append_child(const Path *path);

                status_t        append(const char *path);
                status_t        append(const LSPString *path);
                status_t        append(const Path *path);

                status_t        remove_base();
                status_t        remove_base(const char *path);
                status_t        remove_base(const LSPString *path);
                status_t        remove_base(const Path *path);

                status_t        remove_root();

                ssize_t         fmt(const char *fmt...);
                ssize_t         fmt(const LSPString *fmt...);
                ssize_t         vfmt(const char *fmt, va_list args);
                ssize_t         vfmt(const LSPString *fmt, va_list args);

                bool            is_absolute() const;
                bool            is_relative() const;
                bool            is_canonical() const;
                bool            is_root() const;
                bool            is_dot() const;
                bool            is_dotdot() const;
                bool            is_dots() const;
                inline bool     is_empty() const                        { return sPath.is_empty();  }

                inline void     clear()                                 { sPath.clear();    }

                inline void     swap(Path *path)                        { sPath.swap(&path->sPath); }

                status_t        canonicalize();

                status_t        root();
                status_t        current();
                status_t        parent();

                status_t        get_canonical(char *path, size_t maxlen) const;
                status_t        get_canonical(LSPString *path) const;
                status_t        get_canonical(Path *path) const;

                status_t        as_relative(const char *path);
                status_t        as_relative(const LSPString *path);
                status_t        as_relative(const Path *path);

                bool            equals(const Path *path) const;
                bool            equals(const LSPString *path) const;
                bool            equals(const char *path) const;

                inline const    LSPString *as_string() const                        { return &sPath;                    }
                inline const    char *as_utf8() const                               { return sPath.get_utf8();          }
                inline const    char *as_native(const char *charset = NULL) const   { return sPath.get_native(charset); }
                inline void     take(Path *src)                                     { sPath.take(&src->sPath);          }
                inline size_t   length() const                                      { return sPath.length();            }
                void            take(LSPString *src);
                void            drain(LSPString *dst);

            public:
                // Some kind of file operations
                /**
                 * Return information about the file
                 * @param attr pointer to structure to store the information
                 * @return status of operaiton
                 */
                status_t        stat(fattr_t *attr) const;

                /**
                 * Return information about the file, do not follow symbolic links
                 * @param attr pointer to structure to store the information
                 * @return status of operaiton
                 */
                status_t        sym_stat(fattr_t *attr) const;

                /**
                 * Get the final path of the physical file/device. That means, if the path name is a symbolic link
                 * or a chain of symbolic links, the function reads them until the object associated with the path name
                 * becomes the non-symbolic link.
                 *
                 * @param path variable to store the path
                 * @return status of operation
                 */
                status_t        final_path(LSPString *path) const;

                /**
                 * Get the final path of the physical file/device. That means, if the path name is a symbolic link
                 * or a chain of symbolic links, the function reads them until the object associated with the path name
                 * becomes the non-symbolic link.
                 *
                 * @param path variable to store the path
                 * @return status of operation
                 */
                status_t        final_path(Path *path) const;

                /**
                 * Convert current path to the final path of the physical file/device. That means, if the path name
                 * is a symbolic link or a chain of symbolic links, the function reads them until the object associated
                 * with the path name becomes the non-symbolic link.
                 * @return status of operation
                 */
                status_t        to_final_path();

                /**
                 * Obtain the size of the file
                 * @return file size or negative error code
                 */
                wssize_t        size() const;

                /**
                 * Check that path entry exists on file system
                 * @return true if path entry exists on file system
                 */
                bool            exists() const;
                /**
                 * Check that path entry exists on file system and is a regular file
                 * @return true if path entry exists on file system and is a regular file
                 */
                bool            is_reg() const;
                /**
                 * Check that path entry exists on file system and is a directory
                 * @return true if path entry exists on file system and is a directory
                 */
                bool            is_dir() const;
                /**
                 * Check that path entry exists on file system and is a block device
                 * @return true if path entry exists on file system and is a block device
                 */
                bool            is_block_dev() const;
                /**
                 * Check that path entry exists on file system and is a character device
                 * @return true if path entry exists on file system and is a character device
                 */
                bool            is_char_dev() const;
                /**
                 * Check that path entry exists on file system and is a FIFO
                 * @return true if path entry exists on file system and is a FIFO
                 */
                bool            is_fifo() const;
                /**
                 * Check that path entry exists on file system and is a symbolic link
                 * @return true if path entry exists on file system and is a symbolic link
                 */
                bool            is_symlink() const;
                /**
                 * Check that path entry exists on file system and is a socket
                 * @return true if path entry exists on file system and is a socket
                 */
                bool            is_socket() const;

                /**
                 * Create directory associated with the path name
                 * @return status of operation
                 */
                status_t        mkdir() const;
                /**
                 * Create directory associated with the path name
                 * @param recursive flag that allows to perform recursive directory creation
                 * @return status of operation
                 */
                status_t        mkdir(bool recursive) const;
                /**
                 * Create parent directory associated with the path name
                 * @return status of operation
                 */
                status_t        mkparent() const;
                /**
                 * Create parent directory associated with the path name
                 * @param recursive flag that allows to perform recursive directory creation
                 * @return status of operation
                 */
                status_t        mkparent(bool recursive) const;
                /**
                 * Remove the file associated with the path
                 * @return status of operation
                 */
                status_t        remove() const;

                /**
                 * Rename or move the file associated with the path name to another path
                 * @param dst destination file name
                 * @return status of operation
                 */
                status_t        rename(const char *dst) const;
                /**
                 * Rename or move the file associated with the path name to another path
                 * @param dst destination file name
                 * @return status of operation
                 */
                status_t        rename(const LSPString *dst) const;
                /**
                 * Rename or move the file associated with the path name to another path
                 * @param dst destination file name
                 * @return status of operation
                 */
                status_t        rename(const io::Path *dst) const;

            public:
                inline size_t   hash() const                                { return sPath.hash();  }
                inline size_t   compare_to(const io::Path *dst) const       { return sPath.compare_to(&dst->sPath);  }

            public:
                static bool     is_dot(const LSPString *path);
                static bool     is_dot(const io::Path *path);
                static bool     is_dot(const char *path);

                static bool     is_dotdot(const LSPString *path);
                static bool     is_dotdot(const io::Path *path);
                static bool     is_dotdot(const char *path);

                static bool     is_dots(const LSPString *path);
                static bool     is_dots(const io::Path *path);
                static bool     is_dots(const char *path);

                static bool     valid_file_name(const LSPString *fname);
                static bool     valid_path_name(const LSPString *fname);
        };
    } /* namespace io */

    // LLTL specialization for Path class
    namespace lltl
    {
        // Non-const specification
        template <>
        struct hash_spec<io::Path>: public hash_iface
        {
            static size_t hash_func(const void *ptr, size_t size);

            explicit hash_spec()
            {
                hash        = hash_func;
            }
        };

        template <>
        struct compare_spec<io::Path>: public compare_iface
        {
            static ssize_t cmp_func(const void *a, const void *b, size_t size);

            explicit compare_spec()
            {
                compare     = cmp_func;
            }
        };

        template <>
        struct allocator_spec<io::Path>: public allocator_iface
        {
            static void *clone_func(const void *src, size_t size);
            static void free_func(void *ptr);

            explicit allocator_spec()
            {
                clone       = clone_func;
                free        = free_func;
            }
        };

        // Const specification
        template <>
        struct hash_spec<const io::Path>: public hash_iface
        {
            static size_t hash_func(const void *ptr, size_t size);

            explicit hash_spec()
            {
                hash        = hash_func;
            }
        };

        template <>
        struct compare_spec<const io::Path>: public compare_iface
        {
            static ssize_t cmp_func(const void *a, const void *b, size_t size);

            explicit compare_spec()
            {
                compare     = cmp_func;
            }
        };

        template <>
        struct allocator_spec<const io::Path>: public allocator_iface
        {
            static void *clone_func(const void *src, size_t size);
            static void free_func(void *ptr);

            explicit allocator_spec()
            {
                clone       = clone_func;
                free        = free_func;
            }
        };
    } /* namespace lltl */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_PATH_H_ */

/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 17 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_IO_INBUFSTREAM_H_
#define LSP_PLUG_IN_IO_INBUFSTREAM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/stdlib/stdio.h>

namespace lsp
{
    namespace io
    {
        /**
         * This class works as a proxy around the input stream but keeps last
         * read bytes in the internal buffer that allows to roll-back some
         * read operations. This may be useful, for example, for detecting
         * file format when reading files.
         */
        class InBufStream: public IInStream
        {
            private:
                enum ext_flags_t
                {
                    EXT_BUFFERING       = 1 << (NUM_WRAP_FLAGS + 0),
                    EXT_SEEK_BUFFERING  = 1 << (NUM_WRAP_FLAGS + 1)
                };

            private:
                IInStream          *pIS;            // Input stream
                uint8_t            *vBuffer;        // Pointer to the beginning of the ring buffer
                uint32_t            nBufCap;        // Overall ring buffer capacity
                uint32_t            nBufHead;       // Head position inside of the ring buffer
                uint32_t            nBufSize;       // Number of elements stored in the ring buffer
                uint32_t            nBufOff;        // Read offset in the ring buffer
                wsize_t             nPosition;      // Position of the buffer in the stream
                size_t              nWrapFlags;     // Wrap flags

            private:
                bool                init_buffer();
                inline void         clear_buffer();
                status_t            do_close();
                status_t            do_wrap(IInStream *is, size_t flags);

            public:
                explicit InBufStream(size_t buf_size = 0x1000);
                InBufStream(const InBufStream &) = delete;
                InBufStream(InBufStream &&) = delete;
                virtual ~InBufStream() override;

                InBufStream & operator = (const InBufStream &) = delete;
                InBufStream & operator = (InBufStream &&) = delete;

            public: // io::IInStream
                virtual wssize_t    avail() override;
                virtual wssize_t    position() override;
                virtual ssize_t     read_byte() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual wssize_t    seek(wsize_t position) override;
                virtual wssize_t    skip(wsize_t amount) override;
                virtual status_t    close() override;

            public: // Open operations
                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t            open(const char *path);

                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t            open(const LSPString *path);

                /** Open input stream associated with file. Before open currently open stream is closed and it's
                 * state is reset.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t            open(const Path *path);

            public: // Wrap operations
                /** Wrap stdio file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t            wrap(FILE *fd, bool close);

                /** Wrap native file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t            wrap_native(fhandle_t fd, bool close);

                /** Wrap file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t            wrap(File *fd, size_t flags);

                /** Wrap output stream
                 *
                 * @param is input stream
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t            wrap(IInStream *is, size_t flags = 0);

            public: // Buffering operations
                /**
                 * Enable/disable buffering
                 * @param enable buffering enable/disable flag
                 */
                void                set_buffering(bool enable);

                /**
                 * Enable/disable buffering for seek and skip methods.
                 * Non-buffered seek and skip methods flush internal buffer and use the
                 * seek and skip methods of underlying stream if the new position
                 * of the stream is out of the area currently covered by the buffer.
                 * Buffered seek and skip methods aim to fill as much as possibe the
                 * buffer before the seek position if the position is outside of the
                 * area currently covered by the buffer.
                 *
                 * @param enable quick seek mode enable/disable flag
                 */
                void                set_seek_buffering(bool enable);

                /**
                 * Get start position of the area covered by buffer
                 * @return start position
                 */
                inline wssize_t     buffer_position() const         { return nPosition;     }

                /**
                 * Get the size of the area covered by buffer
                 * @return size of the area
                 */
                inline ssize_t      buffer_size() const             { return nBufSize;      }

                /**
                 * Get the maximum possible size of the area covered by buffer
                 * @return maximum possible size of the area
                 */
                inline ssize_t      buffer_capacity() const         { return nBufCap;       }

                /**
                 * Get current read position inside of the area covered by buffer
                 * @return current read position
                 */
                inline ssize_t      buffer_offset() const           { return nBufOff;       }

        };

    } /* namespace io */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_IO_INBUFSTREAM_H_ */

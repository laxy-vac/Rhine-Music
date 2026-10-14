/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 июн. 2018 г.
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

#ifndef LSP_PLUG_IN_IO_STRINGREADER_H_
#define LSP_PLUG_IN_IO_STRINGREADER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IInSequence.h>

namespace lsp
{
    namespace io
    {
        class InStringSequence: public IInSequence
        {
            private:
                LSPString          *pString;
                size_t              nOffset;
                bool                bDelete;
                ssize_t             nMark;
                ssize_t             nMarkLen;

            protected:
                void    do_close();

            public:
                explicit InStringSequence();
                explicit InStringSequence(const LSPString *s);
                explicit InStringSequence(LSPString *s, bool del = false);
                InStringSequence(const InStringSequence &) = delete;
                InStringSequence(InStringSequence &&) = delete;
                virtual ~InStringSequence() override;

                InStringSequence & operator = (const InStringSequence &) = delete;
                InStringSequence & operator = (InStringSequence &&) = delete;

            public:
                status_t                wrap(const LSPString *in);
                status_t                wrap(LSPString *in, bool del);
                status_t                wrap(const char *s, const char *charset);
                status_t                wrap(const char *s);

            public:
                virtual ssize_t         read(lsp_wchar_t *dst, size_t count) override;
                virtual lsp_swchar_t    read() override;
                virtual status_t        read_line(LSPString *s, bool force = false) override;
                virtual ssize_t         skip(size_t count) override;
                virtual status_t        close() override;
                virtual status_t        mark(ssize_t limit) override;
                virtual status_t        reset() override;
        };
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_STRINGREADER_H_ */
